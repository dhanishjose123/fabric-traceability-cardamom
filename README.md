# Cardamom Traceability & Digital Twin - Blockchain Network

This repository contains the full source code and benchmarking tools for the Cardamom Traceability Hyperledger Fabric network. It provides automated scripts to spin up a customized, heavily optimized blockchain network (`fabric-test`), deploy the traceability smart contracts (`backend`), and run intensive performance profiling and predictive benchmarking (`caliper-bench`).

## 📂 Repository Architecture

- **`fabric-test/`**: Contains the core infrastructure scripts to launch the Hyperledger Fabric network, create channels, and deploy smart contracts.
- **`backend/`**: Contains the chaincode (smart contracts) logic that governs the traceability lifecycle, as well as Node.js wallets/connection profiles for client API development.
- **`caliper-bench/`**: Contains the Hyperledger Caliper configuration, JS workload definitions, and extraction utilities for stress-testing the network.
- **`experiments/`**: Contains specific experimental setups, configurations, or results from benchmarking the traceability network.

---

## 🛠️ Operating the Blockchain Network (`fabric-test/`)

The core of the network automation revolves around several key scripts located in `fabric-test`. 

### 1. `channel-stack.sh` (The Network Orchestrator)
`channel-stack.sh` is a highly customized orchestration script built specifically for this project to automate the creation of complex channel structures. 

Instead of manually running standard Fabric scripts step-by-step, you can use `channel-stack.sh` (often called by wrapper scripts) to automatically:
- Parse topology files
- Generate crypto materials using Certificate Authorities
- Create genesis blocks and channel transactions
- Join all necessary peers (e.g., Farmers, Aggregators, Retailers) to the designated channel (like `agrochannel2406`).

### 2. Starting the Network
If you want to spin up the network manually using the primary Fabric scripts, navigate to `fabric-test` and execute:
```bash
cd fabric-test
./network.sh up createChannel -c agrochannel2406 -ca
```
*(The `-ca` flag ensures the network uses Certificate Authorities rather than static cryptogen, which is crucial for a production-like digital twin simulation).*

### 3. Deploying the Chaincode
Once your peers have joined `agrochannel2406`, you must install and commit the traceability smart contract located in the `backend` directory:
```bash
./network.sh deployCC -ccn digitaltwin -ccp ../backend -ccl javascript
```

### 4. Tearing Down the Network
When you are finished running experiments, gracefully tear down the network to free up system resources, stop Docker containers, and clear ledger volumes:
```bash
./network.sh down
```

---

## 🚀 Running Experiments (`caliper-bench/`)

The `caliper-bench` directory is where the true predictive benchmarking happens. It generates massive parallel loads against the deployed chaincode to measure TPS, latency, and system bottlenecks.

### Direct Benchmark Execution
You can run a specific benchmark (for example, `makeoffer` with 1 retailer and 10 lots) by running the core `run.js` execution engine.
```bash
cd caliper-bench
node run.js 0 0 0 makeoffer_r1_10
```

### Matrix (Automated) Execution
To run an entire suite of benchmarking experiments overnight, use the matrix wrapper scripts. These scripts iterate through massive multi-dimensional combinations of workloads (1, 5, 10, 20, 50 lots, etc.):
```bash
node run-latency-matrix.js
```
*This will sequentially run the workloads, wait for Caliper to compile the HTML reports, and log the network telemetry.*

### Extracting Machine Learning Metrics
Once your experiments are finished, you need to extract the raw data into `.csv` and `.xlsx` files so they can be fed into predictive Machine Learning models (like XGBoost):
```bash
node extractthroughput.js
```
This powerful script will parse all Caliper output reports, intelligently strip out irrelevant background transactions, and generate a clean matrix of exact throughput (TPS), fail rates, and latencies.

---

## 💻 Chaincode & Development (`backend/`)

If you need to modify the business logic (e.g., changing the logic of how a Retailer makes a bid on a Cardamom lot), you must edit the Javascript files inside `backend/`. 

Remember to run `npm install` inside the backend directory if you are testing the Node.js API connections locally. Any time you modify the chaincode, you must tear down the network (`./network.sh down`) and restart it, or deploy a new chaincode sequence version.
