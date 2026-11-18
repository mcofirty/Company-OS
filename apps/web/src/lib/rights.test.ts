import { describe, expect, it } from 'vitest';
import { actionLabel, isReadAction, translateActionName } from './rights';

describe('droits en français', () => {
  it('traduit les actions techniques des connecteurs', () => {
    expect(translateActionName('create_branch')).toBe('Créer une branche');
    expect(translateActionName('get_file_contents')).toBe('Lire le contenu d’un fichier');
    expect(translateActionName('list_issues')).toBe('Lister les tickets (issues)');
    expect(translateActionName('add_comment_to_pending_review')).toBe(
      'Ajouter un commentaire à une revue en attente',
    );
    expect(translateActionName('delete_file')).toBe('Supprimer un fichier');
    expect(translateActionName('search_code')).toBe('Rechercher du code');
    expect(translateActionName('add_issue_comment')).toBe(
      'Ajouter un commentaire de ticket (issue)',
    );
    expect(translateActionName('create_or_update_file')).toBe('Créer ou modifier un fichier');
    expect(translateActionName('issue_read')).toBe('Lire un ticket (issue)');
    expect(translateActionName('list_branches')).toBe('Lister les branches');
  });
  it('garde le libellé français des outils intégrés', () => {
    expect(actionLabel({ action: 'status', label: 'Lire l’état réel de l’entreprise' })).toBe(
      'Lire l’état réel de l’entreprise',
    );
    expect(actionLabel({ action: 'fork_repository', label: 'fork_repository' })).toBe(
      'Dupliquer (fork) un dépôt',
    );
  });
  it('classe consulter / agir', () => {
    expect(isReadAction({ action: 'get_commit', risk: 'external_write' })).toBe(true);
    expect(isReadAction({ action: 'merge_pull_request', risk: 'external_write' })).toBe(false);
  });
});
