"""Interactively create an Argon2 password hash for an environment variable."""

from __future__ import annotations

import getpass

from argon2 import PasswordHasher


def main() -> None:
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Repeat password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    # if len(password) < 12:
    #     raise SystemExit("Use at least 12 characters (prefer a longer passphrase).")
    print(PasswordHasher().hash(password))


if __name__ == "__main__":
    main()
