#!/usr/bin/env python3
"""Encrypt a trip data JSON file into data/trip.enc.json for automatic app updates.

Usage: TRIP_PASS='your passphrase' python3 scripts/encrypt_trip.py trip-data.json data/trip.enc.json
Never commit the plain JSON file; only the encrypted output belongs in the repo.
"""
import base64, json, os, sys
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITER = 250_000
src, dst = sys.argv[1], sys.argv[2]
passphrase = os.environ["TRIP_PASS"].encode()
data = json.load(open(src, encoding="utf-8"))
salt, iv = os.urandom(16), os.urandom(12)
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(passphrase)
ct = AESGCM(key).encrypt(iv, json.dumps(data, ensure_ascii=False).encode("utf-8"), None)
b = lambda x: base64.b64encode(x).decode()
json.dump({"v": int(data.get("version", 0)), "alg": "PBKDF2-SHA256/AES-256-GCM", "iter": ITER, "salt": b(salt), "iv": b(iv), "ct": b(ct)}, open(dst, "w"))
print("wrote", dst, "version", data.get("version"))
