"""
Transactional email for Relay.

Sends verification, password-reset, and (optionally) login-notification
emails over SMTP using aiosmtplib (async, non-blocking).

If SMTP is not configured (no SMTP_HOST set), every send function
gracefully no-ops: it logs the message at info level -- preserving the
previous dev behavior where a self-hosted admin can read the verify/reset
URL straight out of the logs -- and returns False. No exception is ever
raised out of this module; a broken or misconfigured mail server must
never break registration, login, or password reset.
"""
from __future__ import annotations

import logging
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

import aiosmtplib

from app.config import settings

logger = logging.getLogger(__name__)

_BRAND = "Relay"


def _smtp_configured() -> bool:
    return bool(settings.smtp_host)


async def send_email(to: str, subject: str, html: str, text: str | None = None) -> bool:
    """
    Send an email via the configured SMTP server.

    Returns True if the message was handed off to the SMTP server
    successfully, False otherwise (including when SMTP isn't configured).
    Never raises -- all failures are caught, logged, and swallowed so a
    mail outage can't break the request that triggered the send.
    """
    if not _smtp_configured():
        logger.info("SMTP not configured; skipping email to %s (subject=%r)", to, subject)
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()

    if text is None:
        # Very small HTML->text fallback so plaintext clients still get something sane.
        text = _html_to_text(html)

    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
            start_tls=settings.smtp_starttls,
            use_tls=settings.smtp_use_tls,
            timeout=10,
        )
        logger.info("Sent email to %s (subject=%r)", to, subject)
        return True
    except Exception:
        # Swallow everything -- email delivery must never break the caller's flow.
        logger.exception("Failed to send email to %s (subject=%r)", to, subject)
        return False


def _html_to_text(html: str) -> str:
    import re
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _wrap_html(title: str, body_html: str) -> str:
    return f"""\
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f2f3f5;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f3f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#3b82f6;padding:20px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;">{_BRAND}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#2e3338;font-size:15px;line-height:1.5;">
                <h1 style="font-size:20px;margin:0 0 16px;color:#060607;">{title}</h1>
                {body_html}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;color:#80848e;font-size:12px;">
                This is an automated message from {_BRAND}. If you didn't expect this email, you can safely ignore it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _button(url: str, label: str) -> str:
    return (
        f'<p style="margin:24px 0;">'
        f'<a href="{url}" style="background-color:#3b82f6;color:#ffffff;text-decoration:none;'
        f'padding:12px 20px;border-radius:4px;font-weight:bold;display:inline-block;">{label}</a>'
        f"</p>"
        f'<p style="word-break:break-all;font-size:13px;color:#4e5058;">{url}</p>'
    )


async def send_verification_email(to: str, verify_url: str) -> bool:
    """Send the "verify your email" message. Logs the URL either way."""
    logger.info("Email verification URL for %s: %s", to, verify_url)

    subject = f"Verify your {_BRAND} email address"
    body_html = (
        "<p>Welcome to Relay! Please confirm your email address to finish setting up your account.</p>"
        + _button(verify_url, "Verify Email")
        + '<p style="font-size:13px;color:#80848e;">This link expires in 24 hours.</p>'
    )
    html = _wrap_html("Verify your email", body_html)
    text = (
        f"Welcome to Relay!\n\n"
        f"Please confirm your email address by visiting the link below:\n{verify_url}\n\n"
        f"This link expires in 24 hours.\n"
    )
    return await send_email(to, subject, html, text)


async def send_password_reset_email(to: str, reset_url: str) -> bool:
    """Send the "reset your password" message. Logs the URL either way."""
    logger.info("Password reset URL for %s: %s", to, reset_url)

    subject = f"Reset your {_BRAND} password"
    body_html = (
        "<p>We received a request to reset the password for your Relay account.</p>"
        + _button(reset_url, "Reset Password")
        + '<p style="font-size:13px;color:#80848e;">This link expires in 1 hour. '
        "If you didn't request a password reset, you can safely ignore this email.</p>"
    )
    html = _wrap_html("Reset your password", body_html)
    text = (
        f"We received a request to reset the password for your Relay account.\n\n"
        f"Reset it here: {reset_url}\n\n"
        f"This link expires in 1 hour. If you didn't request this, you can ignore this email.\n"
    )
    return await send_email(to, subject, html, text)


async def send_login_notification_email(to: str, when: str, ip: str | None = None) -> bool:
    """Best-effort "new login" notice. Only called when explicitly enabled."""
    subject = f"New login to your {_BRAND} account"
    ip_line_html = f"<p>IP address: <strong>{ip}</strong></p>" if ip else ""
    ip_line_text = f"IP address: {ip}\n" if ip else ""

    body_html = (
        f"<p>Your Relay account was just signed in to.</p>"
        f"<p>Time: <strong>{when}</strong></p>"
        f"{ip_line_html}"
        '<p style="font-size:13px;color:#80848e;">If this wasn\'t you, change your password immediately.</p>'
    )
    html = _wrap_html("New login detected", body_html)
    text = (
        f"Your Relay account was just signed in to.\n\n"
        f"Time: {when}\n"
        f"{ip_line_text}\n"
        f"If this wasn't you, change your password immediately.\n"
    )
    return await send_email(to, subject, html, text)
