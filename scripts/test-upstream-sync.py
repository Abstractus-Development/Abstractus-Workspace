"""Exercise the actual sync helper with disposable Git repositories, no network."""
import importlib.util, io, json, pathlib, subprocess, sys, tempfile, unittest
from contextlib import redirect_stdout
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).with_name('upstream-sync.py')
spec = importlib.util.spec_from_file_location('upstream_sync', SCRIPT)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class SyncSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='abstractus-sync-test-')
        self.root = pathlib.Path(self.temp.name)
        self.upstream = self.root/'upstream'
        self.fork = self.root/'fork'
        self.run_git(self.root, 'init', str(self.upstream))
        self.configure(self.upstream)
        (self.upstream/'paper.txt').write_text('base\n', encoding='utf-8')
        self.commit(self.upstream)
        self.base = self.run_git(self.upstream, 'rev-parse', 'HEAD')
        self.run_git(self.root, 'clone', str(self.upstream), str(self.fork))
        self.configure(self.fork)
        self.run_git(self.fork, 'remote', 'rename', 'origin', 'upstream')
        (self.upstream/'paper.txt').write_text('upstream\n', encoding='utf-8')
        self.commit(self.upstream)
        self.run_git(self.fork, 'fetch', 'upstream')
        branch = self.run_git(self.upstream, 'branch', '--show-current')
        self.config = {'remote':'upstream','url':str(self.upstream),'ref':'refs/remotes/upstream/'+branch,'baseRevision':self.base}
        (self.fork/'upstream-sync.json').write_text(json.dumps(self.config), encoding='utf-8')
        (self.fork/'.gitignore').write_text('.upstream-sync/\n', encoding='utf-8')
        self.commit(self.fork)

    def tearDown(self):
        # Git objects are read-only on Windows; TemporaryDirectory cleanup handles them.
        self.temp.cleanup()

    def run_git(self, root, *args):
        return subprocess.run(['git','-C',str(root),*args],check=True,capture_output=True,text=True).stdout.strip()
    def configure(self, root):
        self.run_git(root,'config','user.email','fixture@example.invalid')
        self.run_git(root,'config','user.name','Synthetic sync test')
        self.run_git(root,'config','commit.gpgsign','false')
    def commit(self, root):
        self.run_git(root,'add','.')
        self.run_git(root,'commit','-m','Synthetic fixture')
    def action(self, name):
        with patch.object(sync,'ROOT',self.fork), patch.object(sys,'argv',[str(SCRIPT),name]), redirect_stdout(io.StringIO()):
            sync.main()

    def test_check_is_read_only(self):
        before = self.run_git(self.fork,'status','--porcelain')
        self.action('check')
        self.assertEqual(before,self.run_git(self.fork,'status','--porcelain'))
        self.assertEqual((self.fork/'paper.txt').read_text(),'base\n')

    def test_dirty_work_is_never_stashed_or_overwritten(self):
        (self.fork/'paper.txt').write_text('uncommitted work\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Commit the reviewed'): self.action('prepare')
        self.assertEqual((self.fork/'paper.txt').read_text(),'uncommitted work\n')
        self.assertFalse((self.fork/'.upstream-sync').exists())
        self.assertEqual(self.run_git(self.fork,'stash','list'),'')

    def test_wrong_remote_is_rejected(self):
        self.run_git(self.fork,'remote','set-url','upstream','https://example.invalid/untrusted')
        with self.assertRaisesRegex(ValueError,'Unexpected upstream'): self.action('check')

    def test_conflicts_stay_in_proposal_and_preserve_fork(self):
        (self.fork/'paper.txt').write_text('Abstractus customization\n', encoding='utf-8')
        self.commit(self.fork)
        head = self.run_git(self.fork,'rev-parse','HEAD')
        self.action('prepare')
        proposal = next((self.fork/'.upstream-sync').iterdir())
        self.assertIn('<<<<<<<',(proposal/'paper.txt').read_text())
        self.assertEqual((self.fork/'paper.txt').read_text(),'Abstractus customization\n')
        self.assertEqual(self.run_git(self.fork,'rev-parse','HEAD'),head)
        self.assertEqual(json.loads((self.fork/'upstream-sync.json').read_text())['baseRevision'],self.base)
        self.assertEqual(self.run_git(self.fork,'status','--porcelain'),'')

if __name__ == '__main__': unittest.main()
