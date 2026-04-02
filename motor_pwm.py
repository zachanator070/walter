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
        description="Run a DC motor on a Raspberry Pi GPIO pin using PWM."
    )
    parser.add_argument(
        "--pin",
        type=int,
        default=18,
        help="BCM GPIO pin used for PWM output (default: 18)",
    )
    parser.add_argument(
        "--frequency",
        type=float,
        default=1000.0,
        help="PWM frequency in Hz (default: 1000)",
    )
    parser.add_argument(
        "--duty-cycle",
        type=float,
        default=60.0,
        help="Duty cycle percentage from 0 to 100 (default: 60)",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        help="Optional runtime in seconds. If omitted, runs until Ctrl+C.",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if not 0.0 <= args.duty_cycle <= 100.0:
        raise ValueError("Duty cycle must be between 0 and 100.")
    if args.frequency <= 0:
        raise ValueError("Frequency must be greater than 0.")
    if args.duration is not None and args.duration <= 0:
        raise ValueError("Duration must be greater than 0.")


def main() -> int:
    args = parse_args()

    try:
        validate_args(args)
    except ValueError as error:
        print(f"Argument error: {error}", file=sys.stderr)
        return 2

    GPIO.setmode(GPIO.BCM)
    GPIO.setup(args.pin, GPIO.OUT)

    pwm = GPIO.PWM(args.pin, args.frequency)
    should_stop = False

    def stop_handler(signum, frame):
        del signum, frame
        nonlocal should_stop
        should_stop = True

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    try:
        pwm.start(args.duty_cycle)
        print(
            f"Running PWM on BCM GPIO {args.pin} at {args.frequency} Hz "
            f"with {args.duty_cycle}% duty cycle"
        )

        if args.duration is not None:
            end_time = time.time() + args.duration
            while not should_stop and time.time() < end_time:
                time.sleep(0.1)
        else:
            while not should_stop:
                time.sleep(0.1)
    finally:
        pwm.stop()
        GPIO.cleanup()
        print("PWM stopped and GPIO cleaned up")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())