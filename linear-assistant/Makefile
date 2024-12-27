.PHONY: test-curl-new-thread
test-curl-new-thread:
	curl -X POST http://localhost:8000/webhook/new-email-thread \
		-H "Content-Type: application/json" \
		-d '{"from_address": "test@example.com", \
			"is_test": null, \
			"to_address": "support@company.com", \
			"subject": "New Ticket", \
			"body": "Can you make a new issue for Austin to restock the fridges with tasty beers?", \
			"message_id": "test123", \
			"previous_thread": [], \
			"raw_email": "raw email content" \
			}'

# this sucks for anything beyond basic smoke testing, most of the logic
# should live in baml unittests
.PHONY: test-curl-continued-thread-human-contact
test-curl-continued-thread-human-contact:
	curl -X POST http://localhost:8000/webhook/human-response-on-existing-thread \
		-H "Content-Type: application/json" \
		-d '{ \
			"run_id": "agent-Zoe7fbx9D4c", \
			"call_id": "call-LQvbqRWFCqg", \
			"spec": { \
				"msg": "The team ID provided ('team_supply_maintenance') is not a valid UUID, which caused the issue creation to fail. Please provide a valid UUID for the team.", \
				"subject": null, \
				"channel": { \
					"slack": null, \
					"sms": null, \
					"whatsapp": null, \
					"email": { \
						"address": "test@example.com", \
						"context_about_user": null, \
						"subject": "Re: New Ticket", \
						"references_message_id": "test123", \
						"in_reply_to_message_id": "test123", \
						"experimental_subject_line": "Re: New Ticket", \
						"experimental_references_message_id": "test123", \
						"experimental_in_reply_to_message_id": "test123" \
					} \
				}, \
				"response_options": null, \
				"state": { \
					"events": [ \
						{ \
							"data": { \
								"body": "Can you make a new issue for Austin to restock the fridges with tasty beers?", \
								"from_address": "test@example.com", \
								"is_test": null, \
								"message_id": "test123", \
								"previous_thread": [], \
								"raw_email": "raw email content", \
								"subject": "New Ticket", \
								"to_address": "support@company.com" \
							}, \
							"type": "email_received" \
						}, \
						{ \
							"data": { \
								"intent": "create_issue", \
								"issue": { \
									"description": "Austin is requested to restock the fridges with tasty beers.", \
									"id": null, \
									"team_id": "team_supply_maintenance", \
									"title": "Restock fridges with tasty beers" \
								} \
							}, \
							"type": "create_issue" \
						}, \
						{ \
							"data": "{\"errors\": [{\"message\": \"Argument Validation Error\", \"path\": [\"issueCreate\"], \"locations\": [{\"line\": 3, \"column\": 13}], \"extensions\": {\"code\": \"INVALID_INPUT\", \"type\": \"invalid input\", \"userError\": true, \"userPresentableMessage\": \"teamId must be a UUID.\", \"meta\": {}}}], \"data\": null}", \
							"type": "issue_create_result" \
						}, \
						{ \
							"data": { \
								"intent": "request_more_information", \
								"message": "The team ID provided ('team_supply_maintenance') is not a valid UUID, which caused the issue creation to fail. Please provide a valid UUID for the team." \
							}, \
							"type": "request_more_information" \
						} \
					], \
					"initial_email": { \
						"body": "Can you make a new issue for Austin to restock the fridges with tasty beers?", \
						"from_address": "test@example.com", \
						"is_test": null, \
						"message_id": "test123", \
						"previous_thread": [], \
						"raw_email": "raw email content", \
						"subject": "New Ticket", \
						"to_address": "support@company.com" \
					} \
				} \
			}, \
			"status": { \
				"requested_at": "2024-12-27T00:47:15.226664", \
				"responded_at": null, \
				"response": "use a different team id, perhaps try running list-teams?" \
			} \
		}'

.PHONY: test-curl-continued-thread-function-call
test-curl-continued-thread-function-call:
	curl -X POST http://localhost:8000/webhook/human-response-on-existing-thread \
		-H "Content-Type: application/json" \
		-d '{ \
			"run_id": "agent-aGCBU_MschA", \
			"call_id": "call-6z2u9JfyyWk", \
			"spec": { \
				"fn": "create_issue", \
				"kwargs": { \
					"intent": "create_issue", \
					"issue": { \
						"description": "Austin is requested to restock the fridges with tasty beers.", \
						"id": null, \
						"team_id": "team_supply_maintenance", \
						"title": "Restock fridges with tasty beers" \
					} \
				}, \
				"channel": { \
					"slack": null, \
					"sms": null, \
					"whatsapp": null, \
					"email": { \
						"address": "test@example.com", \
						"context_about_user": null, \
						"subject": "Re: New Ticket", \
						"references_message_id": "test123", \
						"in_reply_to_message_id": "test123", \
						"experimental_subject_line": "Re: New Ticket", \
						"experimental_references_message_id": "test123", \
						"experimental_in_reply_to_message_id": "test123" \
					} \
				}, \
				"reject_options": null, \
				"state": { \
					"events": [ \
						{ \
							"data": { \
								"body": "Can you make a new issue for Austin to restock the fridges with tasty beers?", \
								"from_address": "test@example.com", \
								"is_test": null, \
								"message_id": "test123", \
								"previous_thread": [], \
								"raw_email": "raw email content", \
								"subject": "New Ticket", \
								"to_address": "support@company.com" \
							}, \
							"type": "email_received" \
						}, \
						{ \
							"data": { \
								"intent": "create_issue", \
								"issue": { \
									"description": "Austin is requested to restock the fridges with tasty beers.", \
									"id": null, \
									"team_id": "team_supply_maintenance", \
									"title": "Restock fridges with tasty beers" \
								} \
							}, \
							"type": "create_issue" \
						} \
					], \
					"initial_email": { \
						"body": "Can you make a new issue for Austin to restock the fridges with tasty beers?", \
						"from_address": "test@example.com", \
						"is_test": null, \
						"message_id": "test123", \
						"previous_thread": [], \
						"raw_email": "raw email content", \
						"subject": "New Ticket", \
						"to_address": "support@company.com" \
					} \
				} \
			}, \
			"status": { \
				"requested_at": "2024-12-27T00:38:04.758097", \
				"responded_at": null, \
				"approved": true, \
				"comment": "" \
			} \
		}'