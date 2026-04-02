#!/bin/bash

. ../scripts/envVar.sh  # Loads ORG_NAMES, ORG_PORT_MAP, ORG_CAP_MAP

function one_line_pem {
    # Convert PEM to single line
    echo "`awk 'NF {sub(/\\n/, ""); printf "%s\\\\\\\n",$0;}' $1`"
}

function toProperCase() {
    echo "$(tr '[:lower:]' '[:upper:]' <<< ${1:0:1})${1:1}"
}

function json_ccp {
    local ORG=$1
    local ORG_CAP=$2
    local P0PORT=$3
    local CAPORT=$4
    local PEERPEM=$5
    local CAPEM=$6
    local PP=$(one_line_pem $PEERPEM)
    local CP=$(one_line_pem $CAPEM)
    sed -e "s/\${ORG}/$ORG/" \
        -e "s/\${ORG_CAP}/$ORG_CAP/" \
        -e "s/\${P0PORT}/$P0PORT/" \
        -e "s/\${CAPORT}/$CAPORT/" \
        -e "s#\${PEERPEM}#$PP#" \
        -e "s#\${CAPEM}#$CP#" \
        ccp-template.json
}

function yaml_ccp {
    local ORG=$1
    local ORG_CAP=$2
    local P0PORT=$3
    local CAPORT=$4
    local PEERPEM=$5
    local CAPEM=$6
    local PP=$(one_line_pem $PEERPEM)
    local CP=$(one_line_pem $CAPEM)
    sed -e "s/\${ORG}/$ORG/" \
        -e "s/\${ORG_CAP}/$ORG_CAP/" \
        -e "s/\${P0PORT}/$P0PORT/" \
        -e "s/\${CAPORT}/$CAPORT/" \
        -e "s#\${PEERPEM}#$PP#" \
        -e "s#\${CAPEM}#$CP#" \
        ccp-template.yaml | sed -e $'s/\\\\n/\\\n          /g'
}

# Initial combined JSON
combined_json='{
  "name": "CombinedNetwork",
  "version": "1.0.0",
  "organizations": {},
  "peers": {},
  "certificateAuthorities": {},
  "channels": {
    "defaultchannel": {
      "orderers": ["orderer.example.com"],
      "peers": {}
    }
  },
  "orderers": {
    "orderer.example.com": {
      "url": "grpcs://localhost:7050",
      "tlsCACerts": {
        "path": "organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
      },
      "grpcOptions": {
        "ssl-target-name-override": "orderer.example.com",
        "hostnameOverride": "orderer.example.com"
      }
    }
  }
}'

# Initial combined YAML blocks
combined_orgs="{}"
combined_peers="{}"
combined_cas="{}"
combined_channel_peers="{}"

for ORG in "${ORG_NAMES[@]}"; do
    ORG_CAP=$(toProperCase "$ORG")
    P0PORT=${ORG_PORT_MAP[$ORG]}
    CAPORT=$((P0PORT + 3))

    PEERPEM=peerOrganizations/${ORG}.example.com/tlsca/tlsca.${ORG}.example.com-cert.pem
    CAPEM=peerOrganizations/${ORG}.example.com/ca/ca.${ORG}.example.com-cert.pem

    echo "🔧 Generating CCP for $ORG..."

    mkdir -p peerOrganizations/${ORG}.example.com

    json_file=peerOrganizations/${ORG}.example.com/connection-${ORG}.json
    yaml_file=peerOrganizations/${ORG}.example.com/connection-${ORG}.yaml

    json_ccp "$ORG" "$ORG_CAP" "$P0PORT" "$CAPORT" "$PEERPEM" "$CAPEM" > "$json_file"
    yaml_ccp "$ORG" "$ORG_CAP" "$P0PORT" "$CAPORT" "$PEERPEM" "$CAPEM" > "$yaml_file"

    combined_json=$(jq -s '
    {
      name: "CombinedNetwork",
      version: "1.0.0",
      organizations: (.[0].organizations + .[1].organizations),
      peers: (.[0].peers + .[1].peers),
      certificateAuthorities: (.[0].certificateAuthorities + .[1].certificateAuthorities),
      channels: {
        defaultchannel: {
          orderers: .[0].channels.defaultchannel.orderers,
          peers: (.[0].channels.defaultchannel.peers + .[1].channels.defaultchannel.peers)
        }
      },
      orderers: .[0].orderers
    }' <(echo "$combined_json") "$json_file")

    # Merge YAML blocks
    combined_orgs=$(echo "$combined_orgs" | yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' - <(yq eval '.organizations' "$yaml_file"))
    combined_peers=$(echo "$combined_peers" | yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' - <(yq eval '.peers' "$yaml_file"))
    combined_cas=$(echo "$combined_cas" | yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' - <(yq eval '.certificateAuthorities' "$yaml_file"))
    combined_channel_peers=$(echo "$combined_channel_peers" | yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' - <(yq eval '.channels.defaultchannel.peers' "$yaml_file"))
done

# Final YAML
combined_yaml="name: CombinedNetwork
version: 1.0.0

organizations:
$(echo "$combined_orgs" | sed 's/^/  /')

peers:
$(echo "$combined_peers" | sed 's/^/  /')

certificateAuthorities:
$(echo "$combined_cas" | sed 's/^/  /')

channels:
  defaultchannel:
    orderers:
      - orderer.example.com
    peers:
$(echo "$combined_channel_peers" | sed 's/^/      /')

orderers:
  orderer.example.com:
    url: grpcs://localhost:7050
    tlsCACerts:
      path: organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem
    grpcOptions:
      ssl-target-name-override: orderer.example.com
      hostnameOverride: orderer.example.com
"

echo "$combined_json" > connection-all.json
echo "$combined_yaml" > connection-all.yaml

echo "✅ All individual and combined connection profiles generated!"
