#!/usr/bin/env python3

"""Run a DC motor from a Raspberry Pi GPIO pin using PWM.

Use a transistor or MOSFET driver and a flyback diode; do not drive a DC motor
directly from a Raspberry Pi GPIO pin.
"""

import argparse
import signal
import sys
import time

import RPi.GPIO as GPIO


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Control a DC motor for dispensing liquid (by mL) or priming (continuous) on a Raspberry Pi GPIO pin using PWM."
    )
    parser.add_argument(
        "mode",
        choices=["dispense", "prime"],
        help="Mode: 'dispense' to run for a set volume (mL), 'prime' to run continuously until stopped."
    )
    parser.add_argument(
        "--volume",
        type=float,
        help="Volume to dispense in milliliters (required for 'dispense' mode)",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if args.mode == "dispense":
        if args.volume is None or args.volume <= 0:
            raise ValueError("For 'dispense' mode, --volume (mL) must be provided and > 0.")



def main() -> int:
    args = parse_args()

    pin = 18
    frequency = 1000.0
    duty_cycle = 60.0
    ml_per_sec = 1.0

    try:
        validate_args(args)
    except ValueError as error:
        print(f"Argument error: {error}", file=sys.stderr)
        return 2

    GPIO.setmode(GPIO.BCM)
    GPIO.setup(pin, GPIO.OUT)

    pwm = GPIO.PWM(pin, frequency)
    should_stop = False

    def stop_handler(signum, frame):
        del signum, frame
        nonlocal should_stop
        should_stop = True

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    try:
        pwm.start(duty_cycle)
        print(
            f"Running PWM on BCM GPIO {pin} at {frequency} Hz "
            f"with {duty_cycle}% duty cycle"
        )

        if args.mode == "dispense":
            # Calculate duration based on volume and ml_per_sec
            duration = args.volume / ml_per_sec
            print(f"Dispensing {args.volume} mL (estimated {duration:.2f} seconds)...")
            end_time = time.time() + duration
            while not should_stop and time.time() < end_time:
                time.sleep(0.1)
            print("Dispense complete.")
        elif args.mode == "prime":
            print("Priming motor. Press Ctrl+C to stop.")
            while not should_stop:
                time.sleep(0.1)
            print("Prime stopped.")
    finally:
        pwm.stop()
        GPIO.cleanup()
        print("PWM stopped and GPIO cleaned up")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
