"""Restore normal script-local imports in the isolated, private Python runtime."""
import os
import sys

script = sys.argv[0] if sys.argv else ""
sys.path.insert(0, os.path.dirname(os.path.abspath(script)) if script and not script.startswith("-") else os.getcwd())
