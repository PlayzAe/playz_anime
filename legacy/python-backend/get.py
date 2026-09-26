"""
get.py — Compatibility entry point.
Invokes the modular website runner located at website/run.py.
"""
import os
import sys

# Ensure current directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from website.run import main

if __name__ == "__main__":
    main()
