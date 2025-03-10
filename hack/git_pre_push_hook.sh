set -euo pipefail

npm -C linear-assistant-ts run test
npm -C deploybot-ts run test
