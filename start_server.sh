#!/bin/bash
cd "$(dirname "$0")"
source .venv/bin/activate
python Server/main.py '{
  "episodes": 1000,
  "learningRate": 0.1,
  "gamma": 0.95,
  "epsilon": 1.0,
  "epsilonDecay": 0.995,
  "initialBalance": 10000
}'
