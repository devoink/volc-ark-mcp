import { spawn } from "node:child_process";

export const CREDENTIAL_SERVICE = "volc-ark-mcp";
export const CREDENTIAL_ACCOUNT = "ARK_API_KEY";

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export type CredentialOp = "get" | "set" | "delete";

export type CredentialCommand = {
  file: string;
  args: string[];
  input?: string;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: CredentialCommand) => Promise<CommandResult>;

export type CredentialBackend = "keychain" | "credential-manager" | "secret-service";

export function credentialBackend(platform: NodeJS.Platform = process.platform): CredentialBackend {
  if (platform === "darwin") return "keychain";
  if (platform === "win32") return "credential-manager";
  return "secret-service";
}

export function backendLabel(backend: CredentialBackend): string {
  if (backend === "keychain") return "macOS 钥匙串";
  if (backend === "credential-manager") return "Windows 凭据管理器";
  return "Linux Secret Service";
}

export function credentialCommand(platform: NodeJS.Platform, op: CredentialOp, key?: string): CredentialCommand {
  if (platform === "darwin") return macCommand(op, key);
  if (platform === "win32") return windowsCommand(op, key);
  return linuxCommand(op, key);
}

function macCommand(op: CredentialOp, key?: string): CredentialCommand {
  const base = ["-s", CREDENTIAL_SERVICE, "-a", CREDENTIAL_ACCOUNT];
  if (op === "set") return { file: "security", args: ["add-generic-password", "-U", ...base, "-w", key ?? ""] };
  if (op === "get") return { file: "security", args: ["find-generic-password", ...base, "-w"] };
  return { file: "security", args: ["delete-generic-password", ...base] };
}

function linuxCommand(op: CredentialOp, key?: string): CredentialCommand {
  const attributes = ["service", CREDENTIAL_SERVICE, "account", CREDENTIAL_ACCOUNT];
  if (op === "set") {
    return {
      file: "secret-tool",
      args: ["store", `--label=${CREDENTIAL_SERVICE}`, ...attributes],
      input: key ?? "",
    };
  }
  if (op === "get") return { file: "secret-tool", args: ["lookup", ...attributes] };
  return { file: "secret-tool", args: ["clear", ...attributes] };
}

function windowsCommand(op: CredentialOp, key?: string): CredentialCommand {
  const encoded = Buffer.from(windowsScript(op), "utf16le").toString("base64");
  return {
    file: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    input: op === "set" ? key ?? "" : undefined,
  };
}

function windowsScript(op: CredentialOp): string {
  return `
$ErrorActionPreference = 'Stop'
$target = '${CREDENTIAL_SERVICE}/${CREDENTIAL_ACCOUNT}'
$mode = '${op}'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SeedanceCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct NativeCredential {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWrite([In] ref NativeCredential credential, uint flags);
  [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credential);
  [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("advapi32")]
  public static extern void CredFree(IntPtr cred);
}
"@
$secret = [Console]::In.ReadToEnd().Trim()
if ($mode -eq 'set') {
  if (-not $secret) { Write-Error 'empty key'; exit 1 }
  $bytes = [Text.Encoding]::Unicode.GetBytes($secret)
  $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
  $cred = New-Object SeedanceCred+NativeCredential
  $cred.Type = 1
  $cred.TargetName = $target
  $cred.UserName = '${CREDENTIAL_ACCOUNT}'
  $cred.Comment = '${CREDENTIAL_SERVICE}'
  $cred.CredentialBlob = $blob
  $cred.CredentialBlobSize = [uint32]$bytes.Length
  $cred.Persist = 2
  $ok = [SeedanceCred]::CredWrite([ref]$cred, 0)
  [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
  if (-not $ok) { Write-Error ('CredWrite ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 1 }
  exit 0
}
if ($mode -eq 'delete') {
  [void][SeedanceCred]::CredDelete($target, 1, 0)
  exit 0
}
$ptr = [IntPtr]::Zero
$found = [SeedanceCred]::CredRead($target, 1, 0, [ref]$ptr)
if (-not $found) { Write-Output '__MISSING__'; exit 0 }
$cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][SeedanceCred+NativeCredential])
$out = New-Object byte[] $cred.CredentialBlobSize
[Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $out, 0, $out.Length)
[SeedanceCred]::CredFree($ptr)
[Console]::Out.Write([Text.Encoding]::Unicode.GetString($out))
`.trim();
}

export function spawnCommand(command: CredentialCommand): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({ code: 127, stdout: "", stderr: error.message });
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(command.input ?? "");
  });
}

function missingTool(): CredentialError {
  return new CredentialError("找不到系统凭据工具。macOS 需要 security，Windows 需要 PowerShell，Linux 需要 secret-tool（libsecret）。");
}

function isMissing(result: CommandResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return result.code === 44 || text.includes("__missing__") || text.includes("could not be found") || text.includes("not found");
}

export function createCredentialStore(platform: NodeJS.Platform = process.platform, runner: CommandRunner = spawnCommand) {
  return {
    backend: credentialBackend(platform),
    async get(): Promise<string | undefined> {
      const result = await runner(credentialCommand(platform, "get"));
      if (result.code === 127) throw missingTool();
      if (isMissing(result)) return undefined;
      if (result.code !== 0) throw new CredentialError("读取系统凭据失败。");
      const value = result.stdout.trim();
      return value || undefined;
    },
    async set(key: string): Promise<void> {
      const result = await runner(credentialCommand(platform, "set", key));
      if (result.code === 127) throw missingTool();
      if (result.code !== 0) throw new CredentialError("写入系统凭据失败。");
    },
    async delete(): Promise<void> {
      const result = await runner(credentialCommand(platform, "delete"));
      if (result.code === 127) throw missingTool();
      if (result.code !== 0 && !isMissing(result)) throw new CredentialError("删除系统凭据失败。");
    },
  };
}

export const credentialStore = createCredentialStore();
