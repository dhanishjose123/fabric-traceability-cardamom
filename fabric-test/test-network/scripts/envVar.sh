#!/bin/bash

# SPDX-License-Identifier: Apache-2.0

# Default to current directory if not set
TEST_NETWORK_HOME=${TEST_NETWORK_HOME:-${PWD}}

# Enable TLS
export CORE_PEER_TLS_ENABLED=true
export ORDERER_CA=${TEST_NETWORK_HOME}/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem

# Input orgs as names

# Declare mappings
declare -A ORG_PORT_MAP=(
  [farmers]=7051
  [aggregators]=8051
  [retailers]=9051
  [consumers]=10051
  [bank]=11051
  
)

declare -A ORG_CAP_MAP=(
  [farmers]=Farmers
  [aggregators]=Aggregators
  [retailers]=Retailers
  [consumers]=Consumers
  [bank]=Bank
)
# Which orgs to generate
ORG_NAMES=("bank" "consumers"  "aggregators" "farmers" "retailers" )
export ORDERER_CA_NAME="ca-orderer"
# Preferred: fixed CA port map (stable, no surprises)
declare -A ORG_CA_PORT_MAP=(
  [farmers]=15051
  [aggregators]=16051
  [retailers]=17051
  [consumers]=18051
  [bank]=21051
)


# Ops/metrics ports
declare -A ORG_CA_OP_PORT_MAP=(
  [farmers]=25051
  [aggregators]=26051
  [retailers]=27051
  [consumers]=28051
  [bank]=31051
  
)

# Orderer CA port
ORDERER_CA_PORT=12051
ORDERER_CA_OP_PORT=19054

# Optional fallbacks if a map entry is missing (or you add new orgs later)
BASE_CA_PORT=${BASE_CA_PORT:-15051}
BASE_OP_PORT=${BASE_OP_PORT:-25051}
PORT_STEP=${PORT_STEP:-1000}

# TLS root certs
for ORG in "${ORG_NAMES[@]}"; do
  export PEER0_${ORG}_CA=${TEST_NETWORK_HOME}/organizations/peerOrganizations/${ORG}.example.com/tlsca/tlsca.${ORG}.example.com-cert.pem
done

# Set environment for an org (input: org1, org2, etc.)
setGlobals() {
  ORG=$1

  ORG_CAP=${ORG_CAP_MAP[$ORG]}
  PORT=${ORG_PORT_MAP[$ORG]}
  ROOT_CA_VAR="PEER0_${ORG}_CA"
  TLS_CA=${!ROOT_CA_VAR}

  if [ -z "$PORT" ] || [ -z "$TLS_CA" ]; then
    echo "❌ Unknown organization: $ORG"
    exit 1
  fi

  export CORE_PEER_LOCALMSPID="${ORG_CAP}MSP"
  export CORE_PEER_TLS_ROOTCERT_FILE=$TLS_CA
  export CORE_PEER_MSPCONFIGPATH=${TEST_NETWORK_HOME}/organizations/peerOrganizations/${ORG}.example.com/users/Admin@${ORG}.example.com/msp
  export CORE_PEER_ADDRESS=localhost:$PORT

  echo "✅ Environment set for $ORG ($CORE_PEER_LOCALMSPID)"
  if [ "$VERBOSE" = "true" ]; then
    env | grep CORE
  fi
}

# Peer connection parameters
parsePeerConnectionParameters() {
  PEER_CONN_PARMS=()
  PEERS=""

  while [ "$#" -gt 0 ]; do
    ORG=$1
    shift

    setGlobals $ORG
    PEER="peer0.${ORG}"
    PEERS="$PEERS $PEER"
    PEER_CONN_PARMS+=("--peerAddresses" "$CORE_PEER_ADDRESS")
    PEER_CONN_PARMS+=("--tlsRootCertFiles" "$CORE_PEER_TLS_ROOTCERT_FILE")
  done
}

# Debug/test section
for ORG in "${ORG_NAMES[@]}"; do
  echo "🔧 Setting globals for $ORG"
  setGlobals "$ORG"
done
