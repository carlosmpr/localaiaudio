#!/bin/bash
# This script starts the Private AI backend server.

# Get the directory where the script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Run the backend server using Node.js
node "$DIR/resources/backend/index.js"
