# Include local overrides if present
-include Makefile.local

# Default settings (can be overridden in Makefile.local)
SLACK_CHANNEL_ID ?= C07HR5LJ0KT
SLACK_TEAM_ID ?= 
SLACK_USER_ID ?= U07HR5DNQBB
THREAD_TS ?= 1741484452358769
# Define a literal comma for use in conditionals
COMMA := ,

.PHONY: test-curl-new-thread
test-curl-new-thread:
	curl -X POST http://localhost:8001/webhook/generic \
		-H "Content-Type: application/json" \
		-d ' \
		{ \
			"is_test": false, \
			"type": "agent_slack.received", \
			"event": { \
				"thread_ts": "$(THREAD_TS)", \
				"channel_id": "$(SLACK_CHANNEL_ID)", \
				$(if $(SLACK_TEAM_ID),"team_id": "$(SLACK_TEAM_ID)"$(COMMA)) \
				"events": [ \
					{ \
						"from_user_id": "$(SLACK_USER_ID)", \
						"channel_id": "$(SLACK_CHANNEL_ID)", \
						"content": "@deploybot do we have any git commits that need to be deployed?", \
						"message_ts": "$(THREAD_TS)" \
					} \
				] \
			} \
		} \
		'

.PHONY: test-curl-list-vercel-deployments
test-curl-list-vercel-deployments:
	curl -X POST http://localhost:8001/webhook/generic \
		-H "Content-Type: application/json" \
		-d ' \
		{ \
			"is_test": false, \
			"type": "agent_slack.received", \
			"event": { \
				"thread_ts": "$(THREAD_TS)", \
				"channel_id": "$(SLACK_CHANNEL_ID)", \
				$(if $(SLACK_TEAM_ID),"team_id": "$(SLACK_TEAM_ID)"$(COMMA)) \
				"events": [ \
					{ \
						"from_user_id": "$(SLACK_USER_ID)", \
						"channel_id": "$(SLACK_CHANNEL_ID)", \
						"content": "do we need to deploy anything to vercel?", \
						"message_ts": "$(THREAD_TS)" \
					} \
				] \
			} \
		} \
		'