#!/usr/bin/env python3
import json, sys, os

data = json.load(sys.stdin)
my_id = os.environ.get('PAPERCLIP_AGENT_ID', '')
run_id = os.environ.get('PAPERCLIP_RUN_ID', '')

for i in data:
    if i.get('executionRunId') == run_id or i.get('checkoutRunId') == run_id:
        print(f"*** THIS RUN: {i['identifier']} | {i['title'][:80]} | status={i['status']} ***")
    elif i.get('assigneeAgentId') == my_id:
        print(f"MY ISSUE: {i['identifier']} | {i['title'][:80]} | status={i['status']}")