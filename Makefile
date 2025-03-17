test:
	npm -C linear-assistant-ts run test
	npm -C deploybot-ts run test

githooks:
	ln -s hack/git_pre_push_hook.sh .git/hooks/pre-push

# Redis inspection commands
redis-cli-list-all-keys: ## Connect to Redis CLI and list keys
	@docker compose exec redis redis-cli -n 1 keys "*"

redis-shell: ## Get a Redis shell
	@docker compose exec redis redis-cli -n 1
