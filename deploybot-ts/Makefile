.PHONY: test-curl-new-thread
test-curl-new-thread:
	curl -X POST http://localhost:8001/webhook/generic \
		-H "Content-Type: application/json" \
		-d ' \
		{ \
			"is_test": false, \
			"type": "agent_slack.received", \
			"event": { \
				"thread_ts": "1741484452358769", \
				"channel_id": "C07HR5LJ0KT", \
				"events": [ \
					{ \
						"from_user_id": "U07HR5DNQBB", \
						"channel_id": "C07HR5LJ0KT", \
						"content": "@deploybot do we have any git commits that need to be deployed?", \
						"message_ts": "1741484452358769" \
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
				"thread_ts": "1741484452358769", \
				"channel_id": "C07HR5LJ0KT", \
				"events": [ \
					{ \
						"from_user_id": "U07HR5DNQBB", \
						"channel_id": "C07HR5LJ0KT", \
						"content": "do we need to deploy anything to vercel?", \
						"message_ts": "1741484452358769" \
					} \
				] \
			} \
		} \
		'