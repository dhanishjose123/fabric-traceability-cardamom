#!/bin/bash

# SPDX-License-Identifier: Apache-2.0

# Default to current directory if not set
TEST_NETWORK_HOME=${TEST_NETWORK_HOME:-${PWD}}

# Enable TLS
export CORE_PEER_TLS_ENABLED=true
export ORDERER_CA=${TEST_NETWORK_HOME}/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem

# Input orgs as names
ORG_NAMES=("farmers" "aggregators" "retailers" "customers" "bank")

# Declare mappings
declare -A ORG_PORT_MAP=(
  [farmers]=7051
  [aggregators]=8051
  [retailers]=9051
  [customers]=10051
  [bank]=11051
)

declare -A ORG_CAP_MAP=(
  [farmers]=Farmers
  [aggregators]=Aggregators
  [retailers]=Retailers
  [customers]=Customers
  [bank]=Bank
)

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
