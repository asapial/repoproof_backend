import { describe, expect, it } from "vitest";
import { readStrictJson } from "./strictJson";

describe("bounded duplicate-aware JSON data parsing", () => {
  it("accepts standard JSON with harmless whitespace and inert code-shaped strings", () => {
    const value = { a: [1, -2, 0.5, true, null, { value: 'eval("data only")' }] };
    expect(readStrictJson(Buffer.from(JSON.stringify(value, null, 2)), 1000)).toEqual(value);
  });
  it.each(['{"a":1,"a":2}', String.raw`{"a":1,"\u0061":2}`, '{"nested":[{"b":1,"b":2}]}',
    '{"__proto__":{}}', String.raw`{"\u005f_proto__":{}}`, '{"constructor":{}}', '{"prototype":null}',
    '{a:1}', '{"a":1,}', '{"a":()=>{}}', '{"a":NaN}', '{"a":1e999}', '{"a":1} trailing',
    '['.repeat(70) + '0' + ']'.repeat(70), '[' + '0,'.repeat(33000) + '0]', '\uFEFF{}',
  ])("rejects ambiguous/unsupported JSON data: %s", value => {
    expect(() => readStrictJson(Buffer.from(value), 524288)).toThrow("INVALID_JSON");
  });
  it("rejects empty, invalid UTF-8 and oversized bytes before parsing", () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.alloc(101)]) expect(() => readStrictJson(bytes, 100)).toThrow("INVALID_JSON");
  });
});
