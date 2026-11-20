import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { credentialCommand, createCredentialStore, type CredentialCommand } from "../src/credentials.js";

const KEY = "sk-test-seedance-key";

test("三个平台的写入命令都不把 Key 放进本工具的参数", () => {
  for (const platform of ["darwin", "win32", "linux"] as const) {
    const command = credentialCommand(platform, "set", KEY);
    if (platform === "darwin") {
      assert.equal(command.args.at(-1), KEY);
      assert.equal(command.args.slice(0, -1).includes(KEY), false);
    } else {
      assert.equal(command.args.includes(KEY), false);
      assert.equal(command.input, KEY);
    }
  }
});

test("读取和删除命令不携带 Key", () => {
  for (const platform of ["darwin", "win32", "linux"] as const) {
    for (const op of ["get", "delete"] as const) {
      const command = credentialCommand(platform, op, KEY);
      assert.equal(JSON.stringify(command).includes(KEY), false);
    }
  }
});

test("凭据库未配置时读取为空，写入失败不回显 Key", async () => {
  const calls: CredentialCommand[] = [];
  const store = createCredentialStore("darwin", async (command) => {
    calls.push(command);
    if (command.args[0] === "find-generic-password") return { code: 44, stdout: "", stderr: "could not be found" };
    return { code: 1, stdout: "", stderr: `failed ${KEY}` };
  });
  assert.equal(await store.get(), undefined);
  await assert.rejects(() => store.set(KEY), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(KEY), false);
    return true;
  });
  assert.equal(calls[1]?.args.at(-1), KEY);
});

test("config set 拒绝把 Key 写在命令后面", async () => {
  let wrote = "";
  const code = await runCli(["config", "set", KEY], {
    envKey: "",
    store: fakeStore((key) => { wrote = key; }),
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 1);
  assert.equal(wrote, "");
});

test("config list 只显示状态", async () => {
  let output = "";
  const code = await runCli(["config", "list"], {
    platform: "darwin",
    envKey: "",
    store: {
      backend: "keychain",
      async get() { return KEY; },
      async set() {},
      async delete() {},
    },
    stdout: (text) => { output += text; },
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.match(output, /已保存/);
  assert.match(output, /macOS 钥匙串/);
  assert.equal(output.includes(KEY), false);
});

test("test 未保存时不请求方舟", async () => {
  let called = false;
  let output = "";
  const code = await runCli(["test"], {
    envKey: "",
    probe: async () => { called = true; },
    store: fakeStore(() => {}),
    stdout: (text) => { output += text; },
    stderr: (text) => { output += text; },
  });
  assert.equal(code, 1);
  assert.equal(called, false);
  assert.match(output, /未保存/);
  assert.equal(output.includes("token"), false);
});

test("test 连通成功时不显示 Key", async () => {
  let seen = "";
  let output = "";
  const code = await runCli(["test"], {
    envKey: "",
    probe: async (apiKey) => { seen = apiKey; },
    store: {
      backend: "keychain",
      async get() { return KEY; },
      async set() {},
      async delete() {},
    },
    stdout: (text) => { output += text; },
    stderr: (text) => { output += text; },
  });
  assert.equal(code, 0);
  assert.equal(seen, KEY);
  assert.match(output, /已连通/);
  assert.match(output, /macOS 钥匙串/);
  assert.equal(output.includes("token"), false);
  assert.equal(output.includes(KEY), false);
});

test("config set 交互输入后保存，输出不含 Key", async () => {
  let wrote = "";
  let output = "";
  const code = await runCli(["config", "set"], {
    envKey: "",
    prompt: async () => KEY,
    store: fakeStore((key) => { wrote = key; }),
    stdout: (text) => { output += text; },
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(wrote, KEY);
  assert.match(output, /已保存/);
  assert.equal(output.includes(KEY), false);
});

function fakeStore(onSet: (key: string) => void) {
  return {
    backend: "keychain" as const,
    async get() { return undefined; },
    async set(key: string) { onSet(key); },
    async delete() {},
  };
}
