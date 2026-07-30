# Publish LexiLift at `USERNAME.github.io`

## Option 1: Upload through the GitHub website

1. Sign in to GitHub.
2. Create a new **public** repository named exactly `YOUR-USERNAME.github.io`.
3. Do not initialize it with another README or license.
4. Unzip the LexiLift package on your computer.
5. In the empty repository, choose **Add file > Upload files**.
6. Open the unzipped folder and drag **all files and folders inside it** into the upload page. Include hidden folders such as `.github` if your file manager shows them.
7. Commit the files to the `main` branch.
8. Open **Settings > Pages**.
9. Under **Build and deployment**, select **GitHub Actions**.
10. Open the **Actions** tab and wait for `Deploy LexiLift to GitHub Pages` to finish.
11. Visit `https://YOUR-USERNAME.github.io/`.

## Option 2: Publish with Git on a computer

After installing Git, open a terminal inside this folder and run:

```bash
./publish.sh YOUR-USERNAME
```

You may be asked to sign in to GitHub. The script does not contain or request a password or access token.

## Updating later

Replace the changed files, commit them to `main`, and push again. GitHub Actions will redeploy the website automatically.

## Installing on a phone

### iPhone

Open the website in Safari, tap **Share**, choose **Add to Home Screen**, and enable **Open as Web App** when shown.

### Android

Open the website in Chrome, open the menu, and choose **Install app** or **Add to Home screen**.
