#!/usr/bin/env python3
"""
Reads temperature from a DS18B20 sensor (1-Wire on GPIO4) and exposes
Prometheus metrics for scraping.

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
  METRICS_PORT, SENSOR_POLL_INTERVAL, SENSOR_MAX_RETRIES, SENSOR_BACKOFF_BASE
"""

import glob
import os
import sys
import time

from prometheus_client import Counter, Gauge, start_http_server


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
METRICS_PORT          = int(os.getenv("METRICS_PORT", "9100"))
SENSOR_POLL_INTERVAL  = float(os.getenv("SENSOR_POLL_INTERVAL", "60"))
SENSOR_MAX_RETRIES    = int(os.getenv("SENSOR_MAX_RETRIES", "5"))
SENSOR_BACKOFF_BASE   = float(os.getenv("SENSOR_BACKOFF_BASE", "5.0"))  # seconds
# ---------------------------------------------------------------------------

TEMPERATURE_CELSIUS = Gauge(
    "walter_thermostat_temperature_celsius",
    "Current tank temperature in degrees Celsius",
)
TEMPERATURE_FAHRENHEIT = Gauge(
    "walter_thermostat_temperature_fahrenheit",
    "Current tank temperature in degrees Fahrenheit",
)
LAST_SUCCESSFUL_READ = Gauge(
    "walter_thermostat_last_successful_read_timestamp_seconds",
    "Unix timestamp of the last successful sensor read",
)
SENSOR_READ_ERRORS = Counter(
    "walter_thermostat_sensor_read_errors_total",
    "Total number of failed sensor read attempts",
)


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


def read_with_retries() -> float | None:
    """Read the sensor, retrying with exponential backoff on failure."""
    last_err: RuntimeError | None = None
    for attempt in range(SENSOR_MAX_RETRIES):
        try:
            return read_ds18b20()
        except RuntimeError as e:
            last_err = e
            SENSOR_READ_ERRORS.inc()
            if attempt < SENSOR_MAX_RETRIES - 1:
                delay = SENSOR_BACKOFF_BASE * (2 ** attempt)
                print(
                    f"Sensor read failed (attempt {attempt + 1}/{SENSOR_MAX_RETRIES}): {e} "
                    f"— retrying in {delay:.1f}s",
                    file=sys.stderr,
                )
                time.sleep(delay)

    print(
        f"Error reading temperature probe after {SENSOR_MAX_RETRIES} attempts: {last_err}",
        file=sys.stderr,
    )
    return None


def poll_loop() -> None:
    """Continuously read the sensor and update Prometheus metrics."""
    while True:
        temp_c = read_with_retries()
        if temp_c is not None:
            temp_f = c_to_f(temp_c)
            TEMPERATURE_CELSIUS.set(temp_c)
            TEMPERATURE_FAHRENHEIT.set(temp_f)
            LAST_SUCCESSFUL_READ.set(time.time())
            print(f"Temperature: {temp_c:.1f} °C / {temp_f:.1f} °F")

        time.sleep(SENSOR_POLL_INTERVAL)


def main() -> None:
    start_http_server(METRICS_PORT)
    print(f"Prometheus metrics available at http://0.0.0.0:{METRICS_PORT}/metrics")
    poll_loop()


if __name__ == "__main__":
    main()
