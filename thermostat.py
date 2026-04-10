#!/usr/bin/env python3
"""
Reads temperature from a DS18B20 sensor (1-Wire on GPIO4) and sends an
email alert if the temperature is outside the safe range for goldfish.

Hardware setup (DS18B20 probe has 3 wires):

  DS18B20 wire colors may vary by manufacturer — always verify with your
  specific sensor's datasheet. The most common color scheme is:

    RED   (VCC / power)  → Pin 1  (3.3V)
    BLACK (GND / ground) → Pin 6  (GND)
    YELLOW or WHITE (DATA / signal) → Pin 7  (GPIO4)

  A 4.7kΩ pull-up resistor is required between the DATA wire and 3.3V:
    One leg of the resistor → Pin 1  (3.3V)
    Other leg               → Pin 7  (GPIO4 / DATA wire)

  Raspberry Pi 40-pin header reference (odd pins on left, even on right):
    Pin 1  = 3.3V       Pin 2  = 5V
    Pin 6  = GND        Pin 7  = GPIO4 (1-Wire data)

Enable 1-Wire on the Pi:
  sudo raspi-config → Interface Options → 1-Wire → Enable
  (or add "dtoverlay=w1-gpio" to /boot/config.txt and reboot)

Configuration (edit the block below or set environment variables):
  EMAIL_FROM, EMAIL_TO, EMAIL_PASSWORD, SMTP_HOST, SMTP_PORT
"""

import glob
import os
import smtplib
import sys
import time
from email.mime.text import MIMEText


def load_dotenv(path: str = ".env") -> None:
    """Load key=value pairs from a .env file into os.environ (if the file exists)."""
    if not os.path.isfile(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key   = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


load_dotenv()

# ---------------------------------------------------------------------------
# Configuration — edit here or override via .env / environment variables
# ---------------------------------------------------------------------------
EMAIL_FROM     = os.getenv("SMTP_USER",     "alerts@example.com")
EMAIL_TO       = os.getenv("SMTP_TO",       "owner@example.com")
EMAIL_PASSWORD = os.getenv("SMTP_PASSWORD", "your_password")
SMTP_HOST      = os.getenv("SMTP_HOST",      "smtp.gmail.com")
SMTP_PORT      = int(os.getenv("SMTP_PORT",  "587"))

# Goldfish safe range in Celsius
TEMP_MIN_C = 20.0
TEMP_MAX_C = 24.0

# Retry / backoff settings for sensor reads
SENSOR_MAX_RETRIES  = int(os.getenv("SENSOR_MAX_RETRIES",  "5"))
SENSOR_BACKOFF_BASE = float(os.getenv("SENSOR_BACKOFF_BASE", "5.0"))  # seconds
# ---------------------------------------------------------------------------


def read_ds18b20() -> float:
    """Return temperature in Celsius from the first DS18B20 found on 1-Wire bus."""
    base = "/sys/bus/w1/devices/"
    sensors = glob.glob(base + "28-*/w1_slave")
    if not sensors:
        raise RuntimeError(
            "No DS18B20 sensor found. Is 1-Wire enabled? "
            "(sudo raspi-config → Interface Options → 1-Wire)"
        )

    with open(sensors[0]) as f:
        lines = f.readlines()

        if len(lines) < 2:
            raise RuntimeError("Sensor returned incomplete data — try again.")

        if "YES" not in lines[0]:
            raise RuntimeError("Sensor CRC check failed — bad reading, try again.")

        equals_pos = lines[1].find("t=")
        if equals_pos == -1:
            raise RuntimeError("Unexpected sensor output format.")

        return float(lines[1][equals_pos + 2:]) / 1000.0


def c_to_f(celsius: float) -> float:
    return celsius * 9 / 5 + 32


def send_alert(subject: str, body: str) -> None:
    """Send an alert email with the given subject and body."""
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"]    = EMAIL_FROM
    msg["To"]      = EMAIL_TO

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.login(EMAIL_FROM, EMAIL_PASSWORD)
        smtp.sendmail(EMAIL_FROM, [EMAIL_TO], msg.as_string())

    print(f"Alert sent to {EMAIL_TO}: {subject}")


def main() -> None:
    temp_c = None
    last_err: RuntimeError | None = None
    for attempt in range(SENSOR_MAX_RETRIES):
        try:
            temp_c = read_ds18b20()
            break
        except RuntimeError as e:
            last_err = e
            if attempt < SENSOR_MAX_RETRIES - 1:
                delay = SENSOR_BACKOFF_BASE * (2 ** attempt)
                print(
                    f"Sensor read failed (attempt {attempt + 1}/{SENSOR_MAX_RETRIES}): {e} "
                    f"— retrying in {delay:.1f}s",
                    file=sys.stderr,
                )
                time.sleep(delay)

    if temp_c is None:
        msg = f"Error reading temperature probe after {SENSOR_MAX_RETRIES} attempts: {last_err}"
        print(msg, file=sys.stderr)
        try:
            send_alert("[Walter] Temperature probe error", msg)
        except Exception as mail_err:
            print(f"Failed to send error alert: {mail_err}", file=sys.stderr)
        sys.exit(1)

    temp_f = c_to_f(temp_c)
    min_f  = c_to_f(TEMP_MIN_C)
    max_f  = c_to_f(TEMP_MAX_C)
    print(f"Temperature: {temp_c:.1f} °C / {temp_f:.1f} °F")

    if TEMP_MIN_C <= temp_c <= TEMP_MAX_C:
        print(f"OK — within safe range ({TEMP_MIN_C}–{TEMP_MAX_C} °C)")
    else:
        condition = f"TOO WARM ({temp_c:.1f} °C / {temp_f:.1f} °F)"        
        if temp_c < TEMP_MIN_C:
            condition = f"TOO COLD ({temp_c:.1f} °C / {temp_f:.1f} °F)"

        subject = f"[Walter] Goldfish tank temperature alert: {condition}"
        body = (
            f"Current temperature: {temp_c:.1f} °C ({temp_f:.1f} °F)\n"
            f"Safe range:          {TEMP_MIN_C:.1f}–{TEMP_MAX_C:.1f} °C "
            f"({min_f:.1f}–{max_f:.1f} °F)\n\n"
            f"Status: {condition}\n\n"
            "Please check the tank immediately."
        )

        print("WARNING — outside safe range, sending alert email...")
        try:
            send_alert(subject, body)
        except Exception as e:
            print(f"Failed to send email: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
