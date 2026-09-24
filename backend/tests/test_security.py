from app.security import SessionManager


def test_changing_password_hash_invalidates_existing_session() -> None:
    sessions = SessionManager("a-long-session-secret-that-is-more-than-32-characters", 3600)
    token, _claims = sessions.issue("guest", "first-password-hash")

    assert sessions.verify(token, "guest", "first-password-hash") is not None
    assert sessions.verify(token, "guest", "replacement-password-hash") is None
    assert sessions.verify(token, "admin", "first-password-hash") is None
