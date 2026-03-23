import os
import sys
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)
from utils.environment import TradingEnv
from utils.agent import QLearningAgent
DATA_PATH = os.path.join(BASE_DIR, "uploaded_data.csv")
MODEL_PATH = os.path.join(BASE_DIR, "models", "q_table.pkl")
RESULTS_DIR = os.path.join(BASE_DIR, "results")
def load_prices(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Data file not found at {path}")
    df = pd.read_csv(path)
    if "Date" in df.columns:
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df = df.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    if "Close" not in df.columns:
        raise ValueError('CSV must contain a column named "Close"')
    df["Close"] = pd.to_numeric(df["Close"], errors="coerce")
    df = df.dropna(subset=["Close"]).reset_index(drop=True)
    if len(df) < 2:
        raise ValueError("Insufficient usable rows in CSV after cleaning.")
    return df["Close"].values.astype(float)
def print_progress(episode, total):
    msg = {"event": "progress", "episode": int(episode), "total": int(total)}
    # Critical: flush=True ensures Node receives the line immediately
    print(json.dumps(msg), flush=True)
def parse_params():
    """
    Read JSON params passed by the server:
      {
        "dataPath": "uploaded_data.csv",
        "episodes": 1000,
        "learningRate": 0.1,
        "gamma": 0.95,
        "epsilon": 1.0,
        "epsilonDecay": 0.995,
        "initialBalance": 10000
      }
    """
    params = {
        "dataPath": DATA_PATH,
        "episodes": None,
        "learningRate": None,
        "gamma": None,
        "epsilon": None,
        "epsilonDecay": None,
        "initialBalance": None
    }
    if len(sys.argv) > 1:
        try:
            incoming = json.loads(sys.argv[1])
            for k in params.keys():
                if k in incoming and incoming[k] is not None:
                    params[k] = incoming[k]
            if params["dataPath"] and not os.path.isabs(params["dataPath"]):
                params["dataPath"] = os.path.join(BASE_DIR, params["dataPath"])
        except Exception:
            arg_path = sys.argv[1]
            params["dataPath"] = arg_path if os.path.isabs(arg_path) else os.path.join(BASE_DIR, arg_path)
    required = ["episodes", "learningRate", "gamma", "epsilon", "epsilonDecay", "initialBalance"]
    missing = [k for k in required if params[k] is None]
    if missing:
        raise ValueError(f"Missing required parameters from server: {', '.join(missing)}")
    params["episodes"] = int(params["episodes"])
    params["learningRate"] = float(params["learningRate"])
    params["gamma"] = float(params["gamma"])
    params["epsilon"] = float(params["epsilon"])
    params["epsilonDecay"] = float(params["epsilonDecay"])
    params["initialBalance"] = float(params["initialBalance"])
    return params
def main():
    try:
        p = parse_params()
        data_path = p["dataPath"]
        EPISODES = p["episodes"]
        lr = p["learningRate"]
        gamma = p["gamma"]
        epsilon = p["epsilon"]
        epsilon_decay = p["epsilonDecay"]
        initial_balance = p["initialBalance"]
        prices = load_prices(data_path)
        env = TradingEnv(data=prices, initial_balance=initial_balance, tx_cost=0.0)
        agent = QLearningAgent(
            action_size=3,
            learning_rate=lr,
            discount_factor=gamma,
            exploration_rate=epsilon,
            exploration_decay=epsilon_decay,
            min_exploration=0.01
        )
        for episode in range(EPISODES):
            state = env.reset()
            done = False
            while not done:
                action = agent.choose_action(state)
                next_state, reward, done, _ = env.step(action)
                agent.learn(state, action, reward, next_state, done)
                state = next_state
            agent.decay_epsilon()
            print_progress(episode + 1, EPISODES)
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        agent.save(MODEL_PATH)
        # Test (greedy)
        env = TradingEnv(data=prices, initial_balance=initial_balance, tx_cost=0.0)
        agent.load(MODEL_PATH)
        agent.epsilon = 0.0
        state = env.reset()
        done = False
        balance_history = []
        while not done:
            action = agent.choose_action(state)
            next_state, reward, done, _ = env.step(action)
            state = next_state
            price = prices[min(env.current_step - 1, len(prices) - 1)]
            total_balance = env.balance + env.position * price
            balance_history.append(float(total_balance))
        os.makedirs(RESULTS_DIR, exist_ok=True)
        plt.figure(figsize=(10, 6))
        plt.plot(balance_history, label="Portfolio Value", color="green")
        plt.title("Agent’s Trading Performance")
        plt.xlabel("Time Step")
        plt.ylabel("Total Portfolio Balance")
        plt.legend()
        plt.grid(True)
        plt.savefig(os.path.join(RESULTS_DIR, "trading_plot.png"))
        plt.close()
        result_json = {
            "portfolioHistory": balance_history,
            "finalBalance": balance_history[-1] if balance_history else None,
            "totalReward": (balance_history[-1] - initial_balance) if balance_history else None,
            "episodesCompleted": EPISODES
        }
        results_path = os.path.join(RESULTS_DIR, "results.json")
        with open(results_path, "w", encoding="utf-8") as f_out:
            json.dump(result_json, f_out, ensure_ascii=False)
        print(json.dumps({"event": "wrote_results", "path": results_path}), flush=True)
    except Exception as e:
        print(json.dumps({"event": "error", "message": str(e)}), file=sys.stderr, flush=True)
        sys.exit(1)
if __name__ == "__main__":
    main()