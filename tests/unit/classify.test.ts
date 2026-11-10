import { describe, expect, it } from 'vitest';
import { classifyUtterance, resolveRoomName } from '@/domain/incidents/classify';

const rooms = [
  { id: 'r-main', name: 'Main Hall' },
  { id: 'r-2', name: 'Room 2' },
  { id: 'r-3', name: 'Room 3' },
];

describe('utterance classification', () => {
  it('identifies an AV fault, its equipment and its urgency', () => {
    const c = classifyUtterance('The microphone in Room 3 has stopped working.');
    expect(c.category).toBe('AV');
    expect(c.equipment).toEqual(['microphone']);
    expect(c.urgency).toBe('HIGH');
  });

  it('treats "mic" and "microphone" as the same equipment', () => {
    expect(classifyUtterance('mic in room 2 is dead').equipment).toEqual(['microphone']);
  });

  it('raises separate concerns from one message', () => {
    const c = classifyUtterance('The microphone is not working, and there are too many people in Room 3.');
    expect(c.categories).toEqual(expect.arrayContaining(['AV', 'CAPACITY']));
    expect(c.categories).toHaveLength(2);
    expect(c.category).toBe('CAPACITY');
  });

  it('classifies overcrowding and full sessions as CAPACITY', () => {
    expect(classifyUtterance('This room is overcrowded.').category).toBe('CAPACITY');
    expect(classifyUtterance('The session I wanted to attend is full.').category).toBe('CAPACITY');
  });

  it('classifies accessibility problems', () => {
    expect(classifyUtterance('I cannot find the accessible entrance.').category).toBe('ACCESSIBILITY');
  });

  it('classifies schedule discrepancies with times', () => {
    const c = classifyUtterance('The schedule says 2 PM, but the speaker says 2:30 PM.');
    expect(c.category).toBe('SCHEDULE');
  });

  it('does not mistake a speaker (a person) for AV equipment', () => {
    expect(classifyUtterance('The speaker says the next session is late').equipment).toEqual([]);
  });

  it('escalates safety wording to CRITICAL', () => {
    expect(classifyUtterance('There is smoke coming from Room 2').urgency).toBe('CRITICAL');
  });

  it('marks low-urgency questions as LOW', () => {
    expect(classifyUtterance('No rush, just a question about the lunch area.').urgency).toBe('LOW');
  });

  it('recognises everyday facilities faults stated as plain sentences', () => {
    expect(classifyUtterance('The lights are flickering.').category).toBe('FACILITIES');
    expect(classifyUtterance('There is a water leak near the stage.').category).toBe('FACILITIES');
  });

  it('keeps a broken device in its own category rather than facilities', () => {
    expect(classifyUtterance('The microphone is broken.').categories).toEqual(['AV']);
    expect(classifyUtterance('The broken chair in the foyer needs fixing.').categories).toEqual(['FACILITIES']);
  });

  it('falls back to GENERAL when nothing matches', () => {
    const c = classifyUtterance('Hello there.');
    expect(c.category).toBe('GENERAL');
    expect(c.categories).toEqual(['GENERAL']);
  });
});

describe('room resolution', () => {
  it('matches an explicit room name', () => {
    expect(resolveRoomName('Is the Main Hall full?', rooms)?.id).toBe('r-main');
  });

  it('matches a bare room number', () => {
    expect(resolveRoomName('mic in room 3 is broken', rooms)?.id).toBe('r-3');
  });

  it('returns null when no room is mentioned', () => {
    expect(resolveRoomName('the projector is broken', rooms)).toBeNull();
  });

  it('does not match a room number that is merely a substring', () => {
    expect(resolveRoomName('room 30 is loud', rooms)).toBeNull();
  });
});
