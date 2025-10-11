#!/usr/bin/env python3
"""
Automated installer for PrivateAI Python dependencies.
This script creates a virtual environment and installs llama-cpp-python with Metal/CUDA support.
"""

import os
import platform
import subprocess
import sys
from pathlib import Path


def get_home_dir():
    """Get user's home directory."""
    return Path.home()


def create_venv(venv_path):
    """Create a Python virtual environment."""
    print(f"Creating virtual environment at {venv_path}...")
    try:
        subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True)
        print("✓ Virtual environment created successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to create virtual environment: {e}")
        return False


def get_pip_executable(venv_path):
    """Get path to pip in the virtual environment."""
    if platform.system() == "Windows":
        return venv_path / "Scripts" / "pip.exe"
    else:
        return venv_path / "bin" / "pip"


def get_python_executable(venv_path):
    """Get path to python in the virtual environment."""
    if platform.system() == "Windows":
        return venv_path / "Scripts" / "python.exe"
    else:
        return venv_path / "bin" / "python"


def install_llama_cpp(pip_exe):
    """Install llama-cpp-python with appropriate acceleration."""
    system = platform.system()

    print(f"\nDetected OS: {system}")
    print("Installing llama-cpp-python...")

    try:
        # Upgrade pip first
        subprocess.run([str(pip_exe), "install", "--upgrade", "pip"], check=True)

        if system == "Darwin":  # macOS
            print("Installing with Metal (GPU) support for Apple Silicon...")
            env = os.environ.copy()
            env["CMAKE_ARGS"] = "-DLLAMA_METAL=on"
            subprocess.run(
                [str(pip_exe), "install", "llama-cpp-python>=0.2.90"],
                env=env,
                check=True
            )
        elif system == "Linux":
            # Try CUDA first, fall back to CPU
            print("Attempting to install with CUDA support...")
            try:
                env = os.environ.copy()
                env["CMAKE_ARGS"] = "-DLLAMA_CUBLAS=on"
                subprocess.run(
                    [str(pip_exe), "install", "llama-cpp-python>=0.2.90"],
                    env=env,
                    check=True
                )
                print("✓ Installed with CUDA support")
            except subprocess.CalledProcessError:
                print("CUDA not available, installing CPU version...")
                subprocess.run(
                    [str(pip_exe), "install", "llama-cpp-python>=0.2.90"],
                    check=True
                )
        else:  # Windows
            print("Installing CPU version (CUDA support requires manual setup)...")
            subprocess.run(
                [str(pip_exe), "install", "llama-cpp-python>=0.2.90"],
                check=True
            )

        print("✓ llama-cpp-python installed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to install llama-cpp-python: {e}")
        return False


def main():
    """Main installation routine."""
    print("=" * 60)
    print("PrivateAI Python Dependencies Installer")
    print("=" * 60)
    print()

    # Setup paths
    home = get_home_dir()
    venv_path = home / ".privateai-venv"

    # Check if venv already exists
    if venv_path.exists():
        print(f"Virtual environment already exists at {venv_path}")
        response = input("Recreate it? (y/n): ").strip().lower()
        if response == 'y':
            print("Removing existing venv...")
            import shutil
            shutil.rmtree(venv_path)
        else:
            print("Using existing venv...")

    # Create venv if needed
    if not venv_path.exists():
        if not create_venv(venv_path):
            print("\n✗ Installation failed!")
            sys.exit(1)

    # Get executables
    pip_exe = get_pip_executable(venv_path)
    python_exe = get_python_executable(venv_path)

    # Install dependencies
    if not install_llama_cpp(pip_exe):
        print("\n✗ Installation failed!")
        sys.exit(1)

    print()
    print("=" * 60)
    print("✓ Installation completed successfully!")
    print("=" * 60)
    print()
    print(f"Python binary: {python_exe}")
    print(f"Virtual environment: {venv_path}")
    print()
    print("You can now run PrivateAI!")


if __name__ == "__main__":
    main()
