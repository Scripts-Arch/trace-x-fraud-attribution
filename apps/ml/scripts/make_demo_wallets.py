"""
Generates cryptographically VALID demo wallets for each chain so the
simulated scenarios use realistic addresses that pass checksum validation.

Prints one address per chain plus a JSON block to paste into config.SAMPLE_SEEDS
and integrations.sandboxComplaints().
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import validation  # noqa: E402

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def sha256d(b: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def base58check(payload: bytes, prefix: bytes) -> str:
    data = prefix + payload
    checksum = sha256d(data)[:4]
    n = int.from_bytes(data + checksum, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    for byte in (data + checksum):
        if byte == 0:
            out = "1" + out
        else:
            break
    return out


def bech32_encode(hrp: str, witver: int, program: bytes) -> str:
    """Reference bech32 (BIP-173) encoder."""
    CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

    def polymod(values):
        GEN = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
        chk = 1
        for v in values:
            b = chk >> 25
            chk = (chk & 0x1FFFFFF) << 5 ^ v
            for i in range(5):
                chk ^= GEN[i] if ((b >> i) & 1) else 0
        return chk

    def hrp_expand(h):
        return [ord(x) >> 5 for x in h] + [0] + [ord(x) & 31 for x in h]

    def convertbits(data, frombits, tobits, pad=True):
        acc = 0
        bits = 0
        ret = []
        maxv = (1 << tobits) - 1
        for value in data:
            acc = (acc << frombits) | value
            bits += frombits
            while bits >= tobits:
                bits -= tobits
                ret.append((acc >> bits) & maxv)
        if pad and bits:
            ret.append((acc << (tobits - bits)) & maxv)
        return ret

    data = [witver] + convertbits(program, 8, 5)
    chk = polymod(hrp_expand(hrp) + data + [0, 0, 0, 0, 0, 0]) ^ 1
    return hrp + "1" + "".join(CHARSET[d] for d in data + [(chk >> 5 * (5 - i)) & 31 for i in range(6)])


def eth_address(seed: bytes) -> str:
    """EIP-55 checksummed address from keccak of a pubkey-like blob."""
    try:
        from Crypto.Hash import keccak
        k = keccak.new(digest_bits=256)
        k.update(b"tracex-demo-pubkey:" + seed)
        raw = k.digest()[-20:]
        k2 = keccak.new(digest_bits=256)
        k2.update(raw.hex().encode())
        digest = k2.hexdigest()
        body = raw.hex()
        mixed = "".join(
            c.upper() if c.isalpha() and int(digest[i], 16) >= 8 else c
            for i, c in enumerate(body)
        )
        return "0x" + mixed
    except ImportError:
        # no pycryptodome: lowercase (checksum not enforceable but valid shape)
        k = hashlib.new("sha3_256", b"tracex-demo:" + seed)
        return "0x" + k.digest()[-20:].hex()


def tron_address(seed: bytes) -> str:
    """Find a nonce whose sha3-256 digest maps into the 'T' base58check range
    (approximation of TRON's keccak; fine for demo wallets)."""
    for nonce in range(100000):
        k = hashlib.new("sha3_256", b"tracex-demo:" + seed + str(nonce).encode())
        addr = base58check(k.digest()[-20:], b"\x41")  # 0x41 + 20 bytes = 25B -> 34 chars
        if addr.startswith("T"):
            return addr
    raise RuntimeError("no T-prefix found")


def main() -> None:
    eth_ok = True
    try:
        import Crypto  # noqa: F401
    except ImportError:
        eth_ok = False

    btc_p2pkh = base58check(hashlib.sha256(b"tracex-demo-btc-p2pkh").digest()[:20], b"\x00")
    btc_p2sh = base58check(hashlib.sha256(b"tracex-demo-btc-p2sh").digest()[:20], b"\x05")
    btc_segwit = bech32_encode("bc", 0, hashlib.sha256(b"tracex-demo-btc-v0").digest()[:20])
    eth = eth_address(b"tracex-demo-eth") if eth_ok else "0x" + hashlib.sha256(b"tracex-demo-eth").hexdigest()[-40:]
    tron = tron_address(b"tracex-demo-tron")
    tron2 = tron_address(b"tracex-demo-tron-2")

    print("P2PKH :", btc_p2pkh)
    print("P2SH  :", btc_p2sh)
    print("P2WPKH:", btc_segwit)
    print("ETH   :", eth)
    print("TRON  :", tron)
    print("TRON2 :", tron2)
    print()
    print("validation:")
    for a in (btc_p2pkh, btc_p2sh, btc_segwit, eth, tron, tron2):
        v = validation.validate(a)
        print(f"  {v.chain} {v.valid} {v.reason}")

    print()
    print("json:")
    import json
    print(json.dumps({
        "btc_p2pkh": btc_p2pkh, "btc_p2sh": btc_p2sh,
        "btc_segwit": btc_segwit, "eth": eth, "tron": tron, "tron2": tron2,
    }, indent=1))


if __name__ == "__main__":
    main()
