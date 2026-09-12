import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client as SshClient } from "ssh2";

export interface SshTarget {
  host: string;
  port: number;
  username: string;
}

export interface TunnelHandle {
  /** Connection string rewritten to point at the local forwarded port. */
  connectionString: string;
  close: () => void;
}

/** Parses "user@host" or "user@host:port" into an SshTarget. */
export function parseSshTarget(spec: string): SshTarget {
  const match = spec.match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid SSH target "${spec}", expected user@host or user@host:port`);
  }
  const [, username, host, port] = match;
  return { username, host, port: port ? Number(port) : 22 };
}

function defaultPrivateKeyPath(): string | null {
  const candidates = ["id_ed25519", "id_rsa"];
  for (const name of candidates) {
    const path = join(homedir(), ".ssh", name);
    try {
      readFileSync(path);
      return path;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Opens an SSH tunnel to `sshTarget` and forwards a local ephemeral port to
 * the database host/port encoded in `dbConnectionString` (as reachable from
 * the SSH host, e.g. a staging bastion reaching a private prod DB).
 *
 * Returns a rewritten connection string pointed at 127.0.0.1:<local port>,
 * plus a `close()` to tear the tunnel down.
 */
export async function openSshTunnel(
  sshTarget: SshTarget,
  dbConnectionString: string,
  privateKeyPath?: string
): Promise<TunnelHandle> {
  const dbUrl = new URL(dbConnectionString);
  const remoteHost = dbUrl.hostname;
  const remotePort = dbUrl.port ? Number(dbUrl.port) : 5432;

  const keyPath = privateKeyPath ?? defaultPrivateKeyPath();
  const ssh = new SshClient();

  await new Promise<void>((resolve, reject) => {
    ssh.on("ready", resolve);
    ssh.on("error", reject);
    ssh.connect({
      host: sshTarget.host,
      port: sshTarget.port,
      username: sshTarget.username,
      privateKey: keyPath ? readFileSync(keyPath) : undefined,
      agent: process.env.SSH_AUTH_SOCK,
      tryKeyboard: false,
    });
  });

  const server = createServer((socket) => {
    ssh.forwardOut(socket.remoteAddress ?? "127.0.0.1", socket.remotePort ?? 0, remoteHost, remotePort, (err, stream) => {
      if (err) {
        socket.destroy(err);
        return;
      }
      socket.pipe(stream).pipe(socket);
    });
  });

  const localPort = await new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

  const rewritten = new URL(dbConnectionString);
  rewritten.hostname = "127.0.0.1";
  rewritten.port = String(localPort);

  return {
    connectionString: rewritten.toString(),
    close: () => {
      server.close();
      ssh.end();
    },
  };
}
