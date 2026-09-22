# One-time GCP wiring: gives this app its own database and user on the existing
# Cloud SQL instance, stores the connection string in Secret Manager, and grants
# the Cloud Run runtime service account the two roles it needs to use them.
#
# It does NOT deploy. The GitHub Actions workflow is the sole source of truth for
# the service's environment (env_vars_update_strategy: overwrite), so anything set
# on the service by hand is reverted on the next push to main. Deploy by pushing
# to main, or by running the workflow manually from the Actions tab.
#
#   powershell -ExecutionPolicy Bypass -File scripts/setup-gcp-db.ps1
#
# Safe to re-run: the database is created only if missing, and the user's password
# plus the secret version are rotated each time (which is why it redeploys after).
#
# Kept strictly ASCII: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as
# cp1252, where the last byte of an em dash becomes a smart quote and silently
# terminates the string it sits in.

param(
  [string]$Project  = "bof-intern",
  [string]$Region   = "asia-southeast1",
  [string]$Instance = "intern-portal-db",
  [string]$Service  = "gms-prjmanagement",
  [string]$DbName   = "gms",
  [string]$DbUser   = "gms_app",
  [string]$SecretName = "database-url"
)

$ErrorActionPreference = "Stop"
$connectionName = "${Project}:${Region}:${Instance}"

Write-Host "Instance : $Instance (shared - also hosts intern_db and hnxcis)"
Write-Host "Creating : database '$DbName', user '$DbUser', secret '$SecretName'"
Write-Host "It does not touch the existing databases or their users."
$reply = Read-Host "Continue? [y/N]"
if ($reply -ne "y" -and $reply -ne "Y") { Write-Host "Aborted."; exit 1 }

# The runtime identity, read off the live service rather than hardcoded.
$runtimeSa = gcloud run services describe $Service --region=$Region --project=$Project `
  --format="value(spec.template.spec.serviceAccountName)"
if (-not $runtimeSa) { throw "Could not read the runtime service account for $Service." }
Write-Host "==> Runtime service account: $runtimeSa"

# --- database ---------------------------------------------------------------
$existingDbs = @(gcloud sql databases list --instance=$Instance --project=$Project --format="value(name)")
if ($existingDbs -contains $DbName) {
  Write-Host "==> Database '$DbName' already exists, leaving it alone."
} else {
  Write-Host "==> Creating database '$DbName'..."
  gcloud sql databases create $DbName --instance=$Instance --project=$Project | Out-Null
}

# --- user -------------------------------------------------------------------
# Alphanumeric only, so the password never needs URL-escaping inside DATABASE_URL.
$chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
$bytes = New-Object byte[] 28
([System.Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
$pass = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

$existingUsers = @(gcloud sql users list --instance=$Instance --project=$Project --format="value(name)")
if ($existingUsers -contains $DbUser) {
  Write-Host "==> User '$DbUser' exists, rotating its password."
  gcloud sql users set-password $DbUser --instance=$Instance --project=$Project --password=$pass | Out-Null
} else {
  Write-Host "==> Creating user '$DbUser'..."
  gcloud sql users create $DbUser --instance=$Instance --project=$Project --password=$pass | Out-Null
}

# --- secret -----------------------------------------------------------------
# The socket form: Cloud Run mounts the instance at /cloudsql/<connection name>
# via --add-cloudsql-instances, so there is no host, port or TLS config.
$url = "postgresql://${DbUser}:${pass}@/${DbName}?host=/cloudsql/${connectionName}"

$secretExists = $true
try { gcloud secrets describe $SecretName --project=$Project 2>&1 | Out-Null } catch { $secretExists = $false }
if (-not $secretExists) {
  Write-Host "==> Creating secret '$SecretName'..."
  gcloud secrets create $SecretName --replication-policy=automatic --project=$Project | Out-Null
}

# Via a temp file, not a pipe: PowerShell would append a newline, and a trailing
# newline inside a connection string breaks the connection in a way that is
# genuinely hard to spot.
$tmp = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($tmp, $url, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "==> Adding a new version of '$SecretName'..."
  gcloud secrets versions add $SecretName --data-file=$tmp --project=$Project | Out-Null
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

# --- iam --------------------------------------------------------------------
Write-Host "==> Granting roles/cloudsql.client..."
gcloud projects add-iam-policy-binding $Project `
  --member="serviceAccount:$runtimeSa" --role="roles/cloudsql.client" --condition=None | Out-Null

Write-Host "==> Granting roles/secretmanager.secretAccessor on '$SecretName'..."
gcloud secrets add-iam-policy-binding $SecretName --project=$Project `
  --member="serviceAccount:$runtimeSa" --role="roles/secretmanager.secretAccessor" | Out-Null

Write-Host ""
Write-Host "========================================================================"
Write-Host "Done. The password was never printed; it lives only in Secret Manager."
Write-Host ""
Write-Host "Deploy to pick it up (the workflow already adds --add-cloudsql-instances"
Write-Host "and reads DATABASE_URL from the secret):"
Write-Host "  git push origin main"
Write-Host "  # or: GitHub -> Actions -> Deploy to Cloud Run -> Run workflow"
Write-Host ""
Write-Host "The server creates its tables at boot, so there is no migration step."
Write-Host "Check it worked:"
Write-Host "  gcloud run services logs read $Service --region=$Region --limit=30"
Write-Host "========================================================================"
