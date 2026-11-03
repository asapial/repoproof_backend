// Owned loopback SMTP fixture. No app endpoint, persistent mailbox or token log.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type TLSSocket } from "node:tls";
export async function verificationMailSink() {
  assert.equal(process.env.EMAIL_SENDER_SMTP_USER, "synthetic-smtp-user"); assert.equal(process.env.EMAIL_SENDER_SMTP_PASS, "synthetic-smtp-password");
  const messages: Array<{ email: string; token: string }> = [], sockets = new Set<TLSSocket>();
  const server = createServer({ key: readFileSync(process.env.RPF_RECOVERY_TLS_KEY!), cert: readFileSync(process.env.RPF_RECOVERY_TLS_CERT!), minVersion: "TLSv1.2" }, socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {}); socket.setTimeout(5000, () => socket.destroy());
    assert.ok(["TLSv1.2", "TLSv1.3"].includes(socket.getProtocol()!));
    let buffer = "", data: string[] | null = null, authenticated = false, email = "", bytes = 0;
    socket.write("220 localhost synthetic verification sink\r\n");
    socket.on("data", chunk => {
      bytes += chunk.length; if (bytes > 65536) { socket.destroy(); return; } buffer += chunk.toString("utf8"); let newline: number;
      while ((newline = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 2);
        if (data !== null) {
          if (line !== ".") { data.push(line); continue; }
          const text = data.join("\r\n").replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
          const link = /http:\/\/localhost:3000\/verify-email#token=([A-Za-z0-9_.-]+)/.exec(text); assert.ok(link && link[1]!.length <= 2048);
          assert.ok(text.includes("Verify your RepoProof email")); messages.push({ email, token: link[1]! }); data = null; socket.write("250 queued locally\r\n");
        } else if (/^EHLO /i.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN /i.test(line)) { assert.equal(Buffer.from(line.slice(11), "base64").toString("utf8"), "\0synthetic-smtp-user\0synthetic-smtp-password"); authenticated = true; socket.write("235 authenticated\r\n"); }
        else if (/^MAIL FROM:/i.test(line)) { assert.ok(authenticated); assert.equal(line.toLowerCase(), "mail from:<accounts@example.test>"); socket.write("250 accepted\r\n"); }
        else if (/^RCPT TO:/i.test(line)) { const match = /^RCPT TO:<([a-z0-9-]+@example\.test)>$/i.exec(line); assert.ok(authenticated && match); email = match[1]!; socket.write("250 accepted\r\n"); }
        else if (line === "DATA") { assert.ok(email && authenticated); data = []; socket.write("354 send data\r\n"); }
        else if (line === "QUIT") socket.end("221 done\r\n");
        else if (line === "RSET") socket.write("250 reset\r\n");
        else throw new Error("Unexpected local verification SMTP command");
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(15443, "127.0.0.1", resolve); });
  return { messages,
    async message(index: number) { const until = Date.now() + 8000; while (!messages[index] && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25)); assert.ok(messages[index], "No local TLS verification mail"); return messages[index]!; },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
