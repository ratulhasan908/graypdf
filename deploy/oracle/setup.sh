#!/usr/bin/env bash
# One-time setup for a fresh Oracle Cloud Ubuntu VM: Docker, firewall, swap.
set -euo pipefail

if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
fi

# Oracle's Ubuntu images block everything except SSH in iptables, even when
# the cloud security list allows it. Open HTTP and HTTPS before the REJECT rule.
for port in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
        || sudo iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo sh -c 'iptables-save > /etc/iptables/rules.v4'

# A little swap so a big Office conversion can't take the server down.
if ! swapon --show | grep -q /swapfile; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "Setup done. Log out and back in so the docker group applies."
