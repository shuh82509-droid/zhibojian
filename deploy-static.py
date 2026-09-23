from pathlib import Path
import runpy
import sys

root = Path(__file__).resolve().parent
deployer = Path(r"D:\飞书下载\fandow-deploy-unified-v5\fandow-deploy\scripts\direct_ssh_static_deploy.py")

sys.argv = [
    str(deployer),
    "deploy",
    "--path", str(root / "dist"),
    "--app", "live-center-workbench",
    "--ssh-user", "account",
    "--connect-method", "system",
    "--strict-host-key-checking", "accept-new",
    "--sudo",
]
runpy.run_path(str(deployer), run_name="__main__")
