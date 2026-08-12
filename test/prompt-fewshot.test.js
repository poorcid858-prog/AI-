"use strict";
const assert = require("assert");
const test = require("node:test");

test("T1: buildDynamicFewShot 返回数组", () => {
  const pe = require("../lib/prompt-engine");
  const result = pe.buildDynamicFewShot("问题", "product", 3, 0.3);
  assert.ok(Array.isArray(result), "应返回数组");
});

test("T2: 空问题返回空", () => {
  const pe = require("../lib/prompt-engine");
  const result = pe.buildDynamicFewShot("", "product", 3, 0.3);
  assert.strictEqual(result.length, 0, "空问题应返回 []");
});

test("T3: 空 role 返回空", () => {
  const pe = require("../lib/prompt-engine");
  const result = pe.buildDynamicFewShot("问题", "", 3, 0.3);
  assert.strictEqual(result.length, 0, "空 role 应返回 []");
});

test("T4: 无效参数返回空", () => {
  const pe = require("../lib/prompt-engine");
  const result = pe.buildDynamicFewShot("问题", "product", 0, 0.3);
  assert.strictEqual(result.length, 0, "n <= 0 应返回 []");
});

test("T5: getSkillPrompt 返回 skill", () => {
  const pe = require("../lib/prompt-engine");
  const skill = pe.getSkillPrompt("product");
  assert.strictEqual(skill.role, "product");
  assert.ok(skill.description);
  assert.ok(skill.outputFormat);
});

test("T6: assemblePrompt 组装完整", () => {
  const pe = require("../lib/prompt-engine");
  const prompt = pe.assemblePrompt({
    role: "test",
    bizLine: "trade",
    userQuestion: "测试用例",
    ragChunks: [{heading: "模板", content: "内容"}],
  });
  assert.ok(prompt.includes("测试工程师"));
  assert.ok(prompt.includes("trade"));
  assert.ok(prompt.includes("测试用例"));
});
