"""Stage Zotero updates in a separate checkout; never overwrite the working fork."""
import argparse, json, pathlib, subprocess, uuid
ROOT=pathlib.Path(__file__).resolve().parent.parent
def git(*args, check=True):
    return subprocess.run(['git','-C',str(ROOT),*args],check=check,capture_output=True,text=True)
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['check','prepare']);p.add_argument('--fetch',action='store_true');a=p.parse_args()
    config=json.loads((ROOT/'upstream-sync.json').read_text())
    remote=config['remote'];ref=config['ref']
    if git('remote','get-url',remote).stdout.strip()!=config['url']:raise ValueError('Unexpected upstream remote; inspect its URL before fetching')
    if a.fetch:git('fetch','--no-tags','--recurse-submodules=no',remote)
    tip=git('rev-parse',ref).stdout.strip();head=git('rev-parse','HEAD').stdout.strip()
    print(git('diff','--stat',config['baseRevision'],tip).stdout or 'No upstream file changes since baseline.')
    if a.action=='check':return
    if git('status','--porcelain').stdout.strip():raise ValueError('Commit the reviewed fork changes before preparing an upstream merge. No files were replaced or stashed.')
    staging=ROOT/'.upstream-sync'/str(uuid.uuid4());staging.parent.mkdir(exist_ok=True)
    git('worktree','add','--detach',str(staging),head)
    result=subprocess.run(['git','-C',str(staging),'merge','--no-commit','--no-ff',tip],capture_output=True,text=True)
    if result.returncode not in (0,1):raise RuntimeError(result.stderr)
    print(result.stdout);print(result.stderr)
    print('Review and test this isolated proposal:',staging)
    print('The fork checkout and its baseline have NOT changed. Resolve conflicts, run the bench, then commit the reviewed proposal before integration.')
if __name__=='__main__':main()
