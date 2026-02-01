#!/bin/bash

echo "===================================="
echo "Starting EcoBacGiang API Server"
echo "===================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "ERROR: .env file not found!"
    echo "Please copy .env.example to .env and configure it."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

echo "Starting server in development mode..."
echo "Server will run at: http://localhost:5000"
echo "Press Ctrl+C to stop the server"
echo ""

npm run dev

