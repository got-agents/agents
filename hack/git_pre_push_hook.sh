set -euo pipefail

npm -C linear-assistant-ts run test
npm -C linear-assistant-ts run build
npm -C deploybot-ts run test
npm -C deploybot-ts run build
