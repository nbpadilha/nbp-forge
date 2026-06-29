// lifecycle: new / remove / restore / gc / rename — plus ref-counted soft-delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { create, remove, restore, gc, rename, init, list } from "../src/lifecycle.mjs";
import { run } from "../src/compose.mjs";
import { makeRoot, bareRoot, write, read, has, recipe, brick, outFile, archived, cleanup } from "./helpers.mjs";

test("new: scaffolds a recipe and builds without error", () => {
  const root = makeRoot({});
  try {
    const r = create("hello", { root });
    assert.equal(r.ok, true, r.msg);
    assert.equal(has(recipe(root, "hello")), true);
    // The stub recipe has no includes, so build succeeds and emits the command.
    assert.equal(r.build.ok, true);
    assert.equal(has(outFile(root, "hello")), true);
  } finally { cleanup(root); }
});

test("new: refuses to overwrite an existing recipe", () => {
  const root = makeRoot({ recipes: { dup: "---\nname: dup\n---\n# dup\n" } });
  try {
    const r = create("dup", { root });
    assert.equal(r.ok, false);
    assert.match(r.msg, /already exists/);
  } finally { cleanup(root); }
});

test("remove (soft): archives recipe + EXCLUSIVE brick, removes command", () => {
  const root = makeRoot({
    bricks: { solo: "exclusive brick body" },
    recipes: { only: "---\nname: only\n---\n# only\n\n<!-- include: solo -->\n" },
  });
  try {
    run({ root, mode: "build" });
    assert.equal(has(outFile(root, "only")), true);

    const r = remove("only", { root });
    assert.equal(r.ok, true, r.msg);
    assert.deepEqual(r.exclusive, ["solo"]);
    // Recipe + exclusive brick gone from live tree…
    assert.equal(has(recipe(root, "only")), false);
    assert.equal(has(brick(root, "solo")), false);
    // …command removed…
    assert.equal(has(outFile(root, "only")), false);
    // …and everything recoverable in the archive.
    assert.equal(has(archived(root, "only", "recipe.md")), true);
    assert.equal(has(archived(root, "only", "bricks", "solo.md")), true);
  } finally { cleanup(root); }
});

test("ref-count: a brick used by 2 skills is KEPT when removing one; the 1-user brick is archived", () => {
  const root = makeRoot({
    bricks: { shared: "shared body", priv: "private body" },
    recipes: {
      a: "---\nname: a\n---\n# a\n\n<!-- include: shared -->\n<!-- include: priv -->\n",
      b: "---\nname: b\n---\n# b\n\n<!-- include: shared -->\n",
    },
  });
  try {
    run({ root, mode: "build" });
    const r = remove("a", { root });
    assert.equal(r.ok, true, r.msg);
    // priv was exclusive to a → archived; shared also used by b → kept.
    assert.deepEqual(r.exclusive, ["priv"]);
    assert.equal(has(brick(root, "priv")), false);
    assert.equal(has(brick(root, "shared")), true, "shared brick must survive");
    assert.ok(r.shared.some((s) => s.brick === "shared" && s.alsoUsedBy.includes("b")));
  } finally { cleanup(root); }
});

test("remove --hard: deletes the recipe + exclusive brick (no archive)", () => {
  const root = makeRoot({
    bricks: { solo: "body" },
    recipes: { gone: "---\nname: gone\n---\n# gone\n\n<!-- include: solo -->\n" },
  });
  try {
    run({ root, mode: "build" });
    const r = remove("gone", { root, hard: true });
    assert.equal(r.ok, true, r.msg);
    assert.equal(r.policy, "hard");
    assert.equal(has(recipe(root, "gone")), false);
    assert.equal(has(brick(root, "solo")), false);
    assert.equal(has(archived(root, "gone", "recipe.md")), false, "hard delete leaves no archive");
  } finally { cleanup(root); }
});

test("remove: unknown skill fails cleanly", () => {
  const root = makeRoot({});
  try {
    const r = remove("ghost", { root });
    assert.equal(r.ok, false);
    assert.match(r.msg, /not found/);
  } finally { cleanup(root); }
});

test("restore: brings back recipe + exclusive brick and rebuilds", () => {
  const root = makeRoot({
    bricks: { solo: "body" },
    recipes: { back: "---\nname: back\n---\n# back\n\n<!-- include: solo -->\n" },
  });
  try {
    run({ root, mode: "build" });
    remove("back", { root });
    assert.equal(has(recipe(root, "back")), false);

    const r = restore("back", { root });
    assert.equal(r.ok, true, r.msg);
    assert.deepEqual(r.restored, ["solo"]);
    assert.equal(has(recipe(root, "back")), true);
    assert.equal(has(brick(root, "solo")), true);
    assert.equal(has(outFile(root, "back")), true, "restore rebuilds the command");
    assert.equal(has(archived(root, "back")), false, "archive entry consumed on restore");
  } finally { cleanup(root); }
});

test("restore: conflict when the recipe already exists", () => {
  const root = makeRoot({
    bricks: { solo: "body" },
    recipes: { c: "---\nname: c\n---\n# c\n\n<!-- include: solo -->\n" },
  });
  try {
    run({ root, mode: "build" });
    remove("c", { root });
    // Recreate a live recipe with the same name → restore must refuse.
    create("c", { root });
    const r = restore("c", { root });
    assert.equal(r.ok, false);
    assert.match(r.msg, /conflict/);
  } finally { cleanup(root); }
});

test("gc: detects an orphan brick, and archives it with --apply", () => {
  const root = makeRoot({
    bricks: { used: "used", orphan: "nobody includes me" },
    recipes: { r: "---\nname: r\n---\n# r\n\n<!-- include: used -->\n" },
  });
  try {
    run({ root, mode: "build" });
    const dry = gc(root, { apply: false });
    assert.deepEqual(dry.orphans, ["orphan"]);
    assert.equal(has(brick(root, "orphan")), true, "dry run must not move anything");

    const applied = gc(root, { apply: true });
    assert.deepEqual(applied.orphans, ["orphan"]);
    assert.equal(has(brick(root, "orphan")), false);
    assert.equal(has(archived(root, "_orphans", "orphan.md")), true);
  } finally { cleanup(root); }
});

test("rename: generates the new command and removes the old one", () => {
  const root = makeRoot({
    bricks: { b: "body" },
    recipes: { oldn: "---\nname: oldn\n---\n# oldn\n\n<!-- include: b -->\n" },
  });
  try {
    run({ root, mode: "build" });
    assert.equal(has(outFile(root, "oldn")), true);

    const r = rename("oldn", "newn", { root });
    assert.equal(r.ok, true, r.msg);
    assert.equal(has(recipe(root, "oldn")), false);
    assert.equal(has(recipe(root, "newn")), true);
    assert.equal(has(outFile(root, "oldn")), false, "old command must be removed");
    assert.equal(has(outFile(root, "newn")), true);
    // The `name:` field inside the recipe is rewritten too.
    assert.match(read(recipe(root, "newn")), /^name:\s*newn\s*$/m);
  } finally { cleanup(root); }
});

test("init: scaffolds config + sample skill from a bare dir and builds it", () => {
  const root = bareRoot(); // no forge.config.json → uses defaults (.claude/forge/...)
  try {
    const r = init(root);
    assert.equal(r.ok, true, r.msg);
    assert.equal(has(join(root, "forge.config.json")), true);
    assert.equal(has(join(root, ".claude/forge/recipes/hello.md")), true);
    assert.equal(has(join(root, ".claude/forge/bricks/footer.md")), true);
    assert.equal(has(join(root, ".claude/commands/hello.md")), true, "sample is built");
    assert.ok(r.created.includes("forge.config.json"));
  } finally { cleanup(root); }
});

test("init: is idempotent and never clobbers an existing project", () => {
  const root = makeRoot({
    bricks: { real: "real body" },
    recipes: { mine: "---\nname: mine\n---\n# mine\n\n<!-- include: real -->\n" },
  });
  try {
    const r = init(root);
    assert.equal(r.ok, true, r.msg);
    // No sample seeded because recipes already exist; the real recipe is untouched.
    assert.equal(has(recipe(root, "hello")), false, "must not seed a sample over a real project");
    assert.equal(read(recipe(root, "mine")).includes("include: real"), true);
    assert.deepEqual(r.created, [], "config already present, recipes present → nothing created");
  } finally { cleanup(root); }
});

test("init: never overwrites an existing brick/output when it would seed the sample", () => {
  const root = bareRoot();
  try {
    // User has a footer brick already (mid-setup) but no recipes yet.
    write(join(root, ".claude/forge/bricks/footer.md"), "MY CUSTOM BRICK");
    const r = init(root);
    assert.equal(r.ok, true, r.msg);
    assert.equal(read(join(root, ".claude/forge/bricks/footer.md")), "MY CUSTOM BRICK", "must not clobber existing brick");
    assert.equal(has(join(root, ".claude/forge/recipes/hello.md")), false, "skips the sample to stay safe");
  } finally { cleanup(root); }
});

test("init: skips the sample when bricks/recipes/out are not three distinct dirs", () => {
  const root = makeRoot({ config: { out: "recipes" } }); // out aliased onto recipes
  try {
    const r = init(root);
    assert.equal(r.ok, true, r.msg);
    assert.equal(has(join(root, "recipes/hello.md")), false, "must not seed when roles collide");
    assert.equal(has(join(root, "bricks/footer.md")), false);
  } finally { cleanup(root); }
});

test("list: reports skills→bricks and per-brick ref-count (blast radius)", () => {
  const root = makeRoot({
    bricks: { shared: "s", priv: "p" },
    recipes: {
      a: "---\nname: a\n---\n# a\n\n<!-- include: shared -->\n<!-- include: priv -->\n",
      b: "---\nname: b\n---\n# b\n\n<!-- include: shared -->\n",
    },
  });
  try {
    const r = list(root);
    assert.equal(r.ok, true);
    const a = r.skills.find((s) => s.skill === "a");
    assert.deepEqual([...a.bricks].sort(), ["priv", "shared"]);
    const shared = r.bricks.find((b) => b.brick === "shared");
    assert.equal(shared.refCount, 2);
    assert.deepEqual(shared.usedBy, ["a", "b"]);
    const priv = r.bricks.find((b) => b.brick === "priv");
    assert.equal(priv.refCount, 1);
    // sorted by ref-count desc → shared first
    assert.equal(r.bricks[0].brick, "shared");
  } finally { cleanup(root); }
});

test("rename: refuses when the target already exists", () => {
  const root = makeRoot({
    recipes: {
      one: "---\nname: one\n---\n# one\n",
      two: "---\nname: two\n---\n# two\n",
    },
  });
  try {
    const r = rename("one", "two", { root });
    assert.equal(r.ok, false);
    assert.match(r.msg, /already exists/);
  } finally { cleanup(root); }
});
