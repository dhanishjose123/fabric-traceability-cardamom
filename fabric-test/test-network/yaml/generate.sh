#!/bin/bash

# Import orgs and helpers from env
source ./envVar.sh

# ─────────────────────────────
# Generate compose-test-net.yaml
# ─────────────────────────────

TEMPLATE="compose-test-net.yaml"
HEADER="compose-test-net-header.yaml"
OUTPUT_DIR="../compose"
OUTPUT_FILE="${OUTPUT_DIR}/compose-test-net.yaml"

if [ ! -f "$TEMPLATE" ]; then
  echo "❌ ERROR: Template file '$TEMPLATE' not found!"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cp "$HEADER" "$OUTPUT_FILE"

for ORG in "${ORG_NAMES[@]}"; do
  PORT="${ORG_PORT_MAP[$ORG]}"
  CHAINCODE_PORT=$((PORT + 1))
  METRICS_PORT=$((PORT + 3443))
  ORGMSP="${ORG^}MSP"

  sed \
    -e "s|\${ORG}|$ORG|g" \
    -e "s|\${PORT}|$PORT|g" \
    -e "s|\${CHAINCODE_PORT}|$CHAINCODE_PORT|g" \
    -e "s|\${METRICS_PORT}|$METRICS_PORT|g" \
    -e "s|\${ORGMSP}|$ORGMSP|g" \
    "$TEMPLATE" >> "$OUTPUT_FILE"

  echo >> "$OUTPUT_FILE"
done

echo "volumes:" >> "$OUTPUT_FILE"
for ORG in "${ORG_NAMES[@]}"; do
  echo "  peer0.${ORG}.example.com:" >> "$OUTPUT_FILE"
done
echo "  orderer.example.com:" >> "$OUTPUT_FILE"

echo -e "\n✅ Compose test-net file generated at: $OUTPUT_FILE"


# ────────────────────────────────────────────────
# Generate docker-compose-test-net.yaml (generic)
# ────────────────────────────────────────────────

GENERIC_TEMPLATE="./docker-compose-test-net.yaml"
GENERIC_OUTPUT_FILE="../compose/docker/docker-compose-test-net.yaml"
rm -f "$GENERIC_OUTPUT_FILE"

echo "version: '3.7'" >> "$GENERIC_OUTPUT_FILE"
echo "" >> "$GENERIC_OUTPUT_FILE"
echo "services:" >> "$GENERIC_OUTPUT_FILE"
echo "" >> "$GENERIC_OUTPUT_FILE"

for ORG in "${ORG_NAMES[@]}"; do
  sed -e "s|\${ORG}|$ORG|g" "$GENERIC_TEMPLATE" >> "$GENERIC_OUTPUT_FILE"
  echo >> "$GENERIC_OUTPUT_FILE"
done

echo -e "\n✅ Generic Docker Compose generated at: $GENERIC_OUTPUT_FILE"


# ─────────────────────────────
# Generate configtx.yaml
# ─────────────────────────────

TOP_FILE="configtx-header.yaml"
ORG_TEMPLATE="configtx-middle.yaml"
CONFIGTX_OUTPUT="../configtx/configtx.yaml"

rm -f "$CONFIGTX_OUTPUT"

# Header
cat "$TOP_FILE" >> "$CONFIGTX_OUTPUT"
echo >> "$CONFIGTX_OUTPUT"

for ORG in "${ORG_NAMES[@]}"; do
  PORT="${ORG_PORT_MAP[$ORG]}"
  ORG_CAP="${ORG^}"
  ORGMSP="${ORG^}MSP"

  sed \
  -e "s|\${ORG}|$ORG|g" \
  -e "s|\${ORG_CAP}|$ORG_CAP|g" \
  -e "s|\${ORGMSP}|$ORGMSP|g" \
  -e "s|\${PORT}|$PORT|g" \
  "$ORG_TEMPLATE" >> "$CONFIGTX_OUTPUT"

  echo >> "$CONFIGTX_OUTPUT"
done

# Profiles section
cat <<EOF >> "$CONFIGTX_OUTPUT"
Profiles:
  ChannelUsingRaft:
    <<: *ChannelDefaults
    Orderer:
      <<: *OrdererDefaults
      OrdererType: etcdraft
      EtcdRaft:
        Consenters:
          - Host: orderer.example.com
            Port: 7050
            ClientTLSCert: ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
            ServerTLSCert: ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
      Organizations:
        - *OrdererOrg
      Capabilities: *OrdererCapabilities
    Application:
      <<: *ApplicationDefaults
      Organizations:
EOF

for ORG in "${ORG_NAMES[@]}"; do
  ORG_CAP="${ORG^}"
  echo "        - *$ORG_CAP" >> "$CONFIGTX_OUTPUT"
done


echo "      Capabilities: *ApplicationCapabilities" >> "$CONFIGTX_OUTPUT"

echo "✅ Configtx file generated at: $CONFIGTX_OUTPUT"


# ─────────────────────────────
# Generate crypto-config.yaml
# ─────────────────────────────

OUTPUT_FILE="../organizations/cryptogen/crypto-config.yaml"
mkdir -p "../organizations/cryptogen"
rm -f "$OUTPUT_FILE"

echo "# ---------------------------------------------------------------------------
# 'PeerOrgs' - Definition of organizations managing peer nodes
# ---------------------------------------------------------------------------
PeerOrgs:" > "$OUTPUT_FILE"

for ORG in "${ORG_NAMES[@]}"; do
  ORG_CAP="${ORG^}"  # Capitalize first letter: farmers → Farmers
  DOMAIN="${ORG}.example.com"

  cat <<EOF >> "$OUTPUT_FILE"

  # ---------------------------------------------------------------------------
  # ${ORG_CAP} Organization
  # ---------------------------------------------------------------------------
  - Name: ${ORG_CAP}
    Domain: ${DOMAIN}
    EnableNodeOUs: true
    Template:
      Count: 1
      SANS:
        - localhost
    Users:
      Count: 5
EOF
done

echo "✅ crypto-config.yaml generated at: ${OUTPUT_FILE}"


cp ./envVar.sh ../scripts/envVar.sh
cp ./createChannel.sh ../scripts/createChannel.sh
cp ./ccutils.sh ../scripts/ccutils.sh
cp ./utils.sh ../scripts/utils.sh
cp ./setAnchorPeer.sh ../scripts/setAnchorPeer.sh
cp ./deployCC.sh ../scripts/deployCC.sh
cp ./ccp-generate.sh ../organizations/ccp-generate.sh
cp ./ccp-template.yaml ../organizations/ccp-template.yaml
cp ./ccp-template.json ../organizations/ccp-template.json
