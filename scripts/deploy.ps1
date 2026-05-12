# DealChat Deployment Script to AWS S3
# Usage: ./deploy.ps1

$BUCKET_NAME = "dealchat-web"
$REGION = "ap-northeast-2" # 한국 리전으로 원복

Write-Host "🚀 Starting deployment to S3 bucket: $BUCKET_NAME..." -ForegroundColor Cyan

# 1. Check if AWS CLI is installed
if (!(Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is not installed. Please install it first."
    exit
}

# 2. Sync files to S3
# --delete: 로컬에 없는 파일은 S3에서도 삭제
# --exclude: 제외할 파일/폴더 지정
Write-Host "📦 Syncing files..." -ForegroundColor Yellow
aws s3 sync . "s3://$BUCKET_NAME" `
    --region $REGION `
    --delete `
    --exclude ".git/*" `
    --exclude ".gemini/*" `
    --exclude ".antigravity/*" `
    --exclude ".claude/*" `
    --exclude ".vscode/*" `
    --exclude "supabase/*" `
    --exclude "node_modules/*" `
    --exclude "scripts/*" `
    --exclude "tests/*" `
    --exclude "_to_delete/*" `
    --exclude ".DS_Store" `
    --exclude "*desktop.ini" `
    --exclude "*.ps1" `
    --exclude "*.sql" `
    --exclude "*.log" `
    --exclude ".gitignore" `
    --exclude "package.json" `
    --exclude "package-lock.json" `
    --exclude "jest.config.js" `
    --exclude "babel.config.json" `
    --exclude "account_test.txt" `
    --exclude "temp_header.js" `
    --exclude "README.md" `
    --exclude "LICENSE"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
    Write-Host "🌐 You can access your website at: http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com" -ForegroundColor Cyan
} else {
    Write-Host "❌ Deployment failed." -ForegroundColor Red
}
