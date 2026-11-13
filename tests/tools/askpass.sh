#!/bin/sh
# git askpass（一次性发版用）：应答用户名/密码均为 token
printf '%s\n' "$GH_PAT"
