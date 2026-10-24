param (
    [string]$Action = "inspect"
)

node scripts/deploy.mjs $Action
