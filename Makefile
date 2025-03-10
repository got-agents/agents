test:
	npm -C linear-assistant-ts run test
	npm -C deploybot-ts run test
githooks:
	ln -s hack/git_pre_push_hook.sh .git/hooks/pre-push

