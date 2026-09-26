import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPublicTarget,
  checkTarget,
  HttpTargetError,
  isPrivateAddress,
  parseTarget,
} from "./guard";

/**
 * The guard on `integration.http`, which is the only registry entry that reaches an
 * arbitrary host — and, being agent-callable, the only one whose destination is chosen
 * by a model reading text that may have arrived on an unauthenticated webhook.
 *
 * These assertions are the security boundary, so they run with no network at all.
 */

const resolvesTo = (...addresses: string[]) => async () => addresses;

test("plain http is refused, because it is the scheme that reaches the metadata server", () => {
  assert.throws(
    () => parseTarget("http://example.com/x"),
    (error: Error) => error instanceof HttpTargetError && /Only https/.test(error.message),
  );
});

test("the metadata server is refused by address, by name, and by scheme", async () => {
  // Any one of these alone would be enough; all three are asserted because this is
  // the request that would hand a run a Google access token for the container.
  assert.equal(isPrivateAddress("169.254.169.254"), true);
  assert.throws(() => parseTarget("https://metadata.google.internal/x"), HttpTargetError);
  assert.throws(() => parseTarget("http://169.254.169.254/computeMetadata/v1/"), HttpTargetError);
  await assert.rejects(
    assertPublicTarget(new URL("https://evil.test/"), resolvesTo("169.254.169.254")),
    HttpTargetError,
  );
});

test("loopback, RFC 1918, CGNAT and multicast are all non-public", () => {
  for (const address of [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.7",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("ordinary public addresses are allowed", () => {
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // just outside 172.16/12
    "100.63.255.255", // just outside the CGNAT block
    "2606:4700::1111",
  ]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("an IPv4 address smuggled inside an IPv6 literal is still that address", () => {
  // ::ffff:169.254.169.254 and its hex form are the same metadata server, and
  // 64:ff9b::/96 is NAT64. A guard that only parsed dotted quads would pass all three.
  assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateAddress("::ffff:a9fe:a9fe"), true);
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("64:ff9b::169.254.169.254"), true);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
});

test("IPv6 loopback, unique-local, link-local and multicast are non-public", () => {
  for (const address of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("something that is neither IPv4 nor IPv6 is refused rather than guessed at", () => {
  assert.equal(isPrivateAddress("not-an-address"), true);
  assert.equal(isPrivateAddress("999.1.1.1"), true);
});

test("localhost and private-zone suffixes are refused before any lookup", () => {
  for (const url of [
    "https://localhost/x",
    "https://LOCALHOST/x",
    "https://api.localhost/x",
    "https://db.internal/x",
    "https://printer.local/x",
    "https://metadata/x",
  ]) {
    assert.throws(() => parseTarget(url), HttpTargetError, url);
  }
});

test("a trailing dot does not escape the hostname block", () => {
  // `localhost.` is the same name to a resolver, and the naive check misses it.
  assert.throws(() => parseTarget("https://localhost./x"), HttpTargetError);
});

test("credentials in the URL are refused", () => {
  assert.throws(() => parseTarget("https://user:pass@example.com/x"), HttpTargetError);
});

test("a host resolving to both a public and a private address is refused", async () => {
  // The reason the check is "every address", not "any address": fetch would pick one.
  await assert.rejects(
    assertPublicTarget(new URL("https://split.test/"), resolvesTo("93.184.216.34", "127.0.0.1")),
    (error: Error) => error instanceof HttpTargetError && /127\.0\.0\.1/.test(error.message),
  );
});

test("a host resolving only to public addresses is allowed", async () => {
  const addresses = await assertPublicTarget(
    new URL("https://ok.test/"),
    resolvesTo("93.184.216.34", "2606:4700::1111"),
  );
  assert.deepEqual(addresses, ["93.184.216.34", "2606:4700::1111"]);
});

test("a literal address in the URL is checked without a lookup", async () => {
  let looked = false;
  const resolver = async () => {
    looked = true;
    return ["8.8.8.8"];
  };
  assert.deepEqual(await assertPublicTarget(new URL("https://8.8.8.8/x"), resolver), ["8.8.8.8"]);
  assert.equal(looked, false);
  await assert.rejects(assertPublicTarget(new URL("https://10.0.0.1/x"), resolver), HttpTargetError);
  await assert.rejects(assertPublicTarget(new URL("https://[::1]/x"), resolver), HttpTargetError);
});

test("a name that does not resolve fails as a target error, not a DNS stack trace", async () => {
  await assert.rejects(
    assertPublicTarget(new URL("https://nope.test/"), async () => {
      throw new Error("ENOTFOUND");
    }),
    (error: Error) => error instanceof HttpTargetError && /Could not resolve/.test(error.message),
  );
});

test("a name resolving to nothing is refused", async () => {
  await assert.rejects(assertPublicTarget(new URL("https://empty.test/"), resolvesTo()), HttpTargetError);
});

test("a malformed URL says what is wrong with it", () => {
  assert.throws(
    () => parseTarget("api.example.com/v1"),
    (error: Error) => error instanceof HttpTargetError && /absolute URL/.test(error.message),
  );
});

test("checkTarget returns the parsed URL alongside the addresses", async () => {
  const { url, addresses } = await checkTarget("  https://api.test/v1/items  ", resolvesTo("93.184.216.34"));
  assert.equal(url.href, "https://api.test/v1/items");
  assert.deepEqual(addresses, ["93.184.216.34"]);
});
