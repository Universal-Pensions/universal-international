import { useState } from 'react';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useEntity, useUpdateBranch } from '../../hooks/useEntity';
import { useToast } from '../../contexts/ToastContext';
import { PageHead, Card, SectionHead, Btn } from '../../employer-dashboard/desktop/ui';
import ui from '../../employer-dashboard/desktop/ui.module.css';
import styles from './SettingsDesktop.module.css';

export default function SettingsDesktop() {
  const { branchId } = useBranchScope();
  const { data: branch } = useEntity('branch', branchId);
  const { addToast } = useToast();
  const updateBranch = useUpdateBranch();

  const [name, setName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');

  // Prefill from the entity once it loads — adjust state during render (guarded
  // on branch.id so it runs once per branch), the React-recommended alternative
  // to a setState-in-effect. Mirrors the `lastSplit` sync in BranchHealthScore.
  const [synced, setSynced] = useState(null);
  if (branch && synced !== branch.id) {
    setSynced(branch.id);
    setName(branch.name || '');
    setManagerName(branch.managerName || '');
    setManagerPhone(branch.managerPhone || '');
  }

  function reset() {
    setName(branch?.name || '');
    setManagerName(branch?.managerName || '');
    setManagerPhone(branch?.managerPhone || '');
  }

  async function handleSave(e) {
    e.preventDefault();
    // A12-007: this used to fire the success toast unconditionally with no
    // mutation behind it at all — a user who edited their branch profile was
    // told it saved when nothing was written anywhere. Route through the same
    // real useUpdateBranch() mutation the distributor's branch-edit panel uses
    // (src/dashboard/branch/ViewBranches.jsx handleSaveEdit) so the toast is
    // contingent on the write actually succeeding.
    try {
      await updateBranch.mutateAsync({
        id: branchId,
        updates: {
          name: name.trim(),
          managerName: managerName.trim(),
          managerPhone: managerPhone.trim(),
        },
      });
      addToast('success', 'Branch profile saved.');
    } catch (err) {
      addToast('error', err?.message || 'Could not save the branch profile. Please try again.');
    }
  }

  return (
    <div className={ui.stack}>
      <PageHead eyebrow="Account" title="Settings" sub="Manage your branch profile and contact details" />

      <div className={styles.wrap}>
        <Card>
          <SectionHead title="Branch profile" />
          <form onSubmit={handleSave}>
            <div className={styles.formGrid}>
              <div className={styles.fg}>
                <label className={styles.label} htmlFor="bs-name">Branch name</label>
                <input id="bs-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className={styles.fg}>
                <label className={styles.label} htmlFor="bs-id">Branch ID</label>
                <input id="bs-id" className={styles.input} value={branch?.id || branchId || ''} disabled />
              </div>
              <div className={styles.fg}>
                <label className={styles.label} htmlFor="bs-mgr">Manager name</label>
                <input id="bs-mgr" className={styles.input} value={managerName} onChange={(e) => setManagerName(e.target.value)} />
              </div>
              <div className={styles.fg}>
                <label className={styles.label} htmlFor="bs-phone">Manager phone</label>
                <input id="bs-phone" className={styles.input} value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} />
              </div>
            </div>
            <div className={styles.actions}>
              <Btn variant="secondary" onClick={reset} disabled={updateBranch.isPending}>Cancel</Btn>
              <Btn variant="primary" type="submit" disabled={updateBranch.isPending}>
                {updateBranch.isPending ? 'Saving…' : 'Save changes'}
              </Btn>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
