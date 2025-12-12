% Sokoban Solver - Optimized
% Uses heuristics, symmetry breaking, and deadlock detection

% ============================================================================
% CONFIGURATION
% ============================================================================
#const max_steps = 50.

% Directions
direction(0, -1; 0, 1; -1, 0; 1, 0).
dir_name(0, -1, up).
dir_name(0, 1, down).
dir_name(-1, 0, left).
dir_name(1, 0, right).

% ============================================================================
% STATIC ANALYSIS (DEADLOCK DETECTION)
% ============================================================================
% Define map bounds
maxx(MX) :- MX = #max { X : cell(X,_,_) }.
maxy(MY) :- MY = #max { Y : cell(_,Y,_) }.

% Identify non-goal floor
nongoal(X,Y) :- cell(X,Y,floor).
nongoal(X,Y) :- cell(X,Y,wall). 
% (Note: cell/3 normally is wall, floor, goal. 'goal' implies it's a valid target)

% Simple Corner Deadlock:
% A floor/ nongoal is a simple dead square if it has walls on two adjacent sides
is_wall(X,Y) :- cell(X,Y,wall).

dead(X,Y) :- cell(X,Y,floor), 
             is_wall(X-1,Y), is_wall(X,Y-1).
dead(X,Y) :- cell(X,Y,floor), 
             is_wall(X+1,Y), is_wall(X,Y-1).
dead(X,Y) :- cell(X,Y,floor), 
             is_wall(X-1,Y), is_wall(X,Y+1).
dead(X,Y) :- cell(X,Y,floor), 
             is_wall(X+1,Y), is_wall(X,Y+1).

% Propagate dead zones (Simplified: Dead end corridors)
% If a cell has 3 blocked sides (walls or dead cells), it is dead
% (This is a simplified recursive deadlock check)
dead(X,Y) :- cell(X,Y,floor),
             3 { is_wall(NX,NY) : direction(DX,DY), NX=X+DX, NY=Y+DY;
                 dead(NX,NY)    : direction(DX,DY), NX=X+DX, NY=Y+DY } 4.

% ============================================================================
% STATE GENERATION
% ============================================================================
% Time steps
time(0..max_steps).

% Initial state
at(X, Y, 0) :- initial_player(X, Y).
box(X, Y, 0) :- initial_box(X, Y).

% Action generation
{ move(DX, DY, T) : direction(DX, DY) } 1 :- time(T), T > 0.

% Position Updates
% Helper: Target position for player
next_pos(X+DX, Y+DY, T) :- at(X, Y, T-1), move(DX, DY, T).

% Constraint: Cannot move into wall
:- next_pos(X, Y, T), is_wall(X, Y).

% Box Interaction
% Define when a push happens
push(X, Y, DX, DY, T) :- 
    at(X, Y, T-1), 
    move(DX, DY, T), 
    box(X+DX, Y+DY, T-1).

% Constraint: Cannot push if interaction is invalid (box blocked or into wall/dead)
:- push(X, Y, DX, DY, T),
   is_wall(X+2*DX, Y+2*DY).
:- push(X, Y, DX, DY, T),
   box(X+2*DX, Y+2*DY, T-1).
:- push(X, Y, DX, DY, T),   % Optimization: Don't push into dead square
   dead(X+2*DX, Y+2*DY).

% Effect: Box moves
box(X+2*DX, Y+2*DY, T) :- push(X, Y, DX, DY, T).

% Effect: Box stays (Inertia)
box(X, Y, T) :- box(X, Y, T-1), not box_moved(X, Y, T), time(T), T > 0.
box_moved(X, Y, T) :- push(PX, PY, DX, DY, T), X = PX+DX, Y = PY+DY.

% Effect: Player moves
at(X, Y, T) :- next_pos(X, Y, T).

% Constraint: Player cannot move into box if not pushing (handled by push check?)
% If next_pos is a box, it MUST be a valid push.
:- next_pos(X, Y, T), box(X, Y, T-1), not push(X-DX, Y-DY, DX, DY, T) : move(DX,DY,T).

% ============================================================================
% HEURISTICS (GOAL DISTANCE)
% ============================================================================
% Compute distance to nearest goal for every cell
% Start at goals
gdist(X, Y, 0) :- cell(X, Y, goal).

% Propagate (BFS)
gdist(X, Y, D+1) :- 
    gdist(NX, NY, D), 
    cell(X, Y, floor), 
    direction(DX, DY), NX=X+DX, NY=Y+DY,
    D < 20, % Limit depth to avoid explosion in large maps
    not gdist(X, Y, D') : D' = 0..D.

gdist(X, Y, D+1) :- 
    gdist(NX, NY, D), 
    cell(X, Y, goal), % Goals are also floor-like
    direction(DX, DY), NX=X+DX, NY=Y+DY,
    D < 20,
    not gdist(X, Y, D') : D' = 0..D.

gdist(X, Y, 21) :- cell(X, Y, _), not gdist(X, Y, D) : D = 0..20. % Unreachable/Far

% ============================================================================
% OPTIMIZATIONS (PRUNING)
% ============================================================================
% 1. Symmetry Breaking: Don't flip-flop
inverse(DX, DY, -DX, -DY) :- direction(DX, DY).
:- move(DX, DY, T), move(PDX, PDY, T-1), 
   inverse(DX, DY, PDX, PDY),
   not push(_, _, _, _, T-1).

% ============================================================================
% MINIMIZATION / SEARCH GUIDANCE
% ============================================================================
% Heuristic: Minimize sum of distances of boxes to goals at every step
% This acts like a potential field pulling boxes to goals.
#minimize { D,X,Y,T : box(X,Y,T), gdist(X,Y,D) }.

% Also minimize total moves (lower priority)
#minimize { 1,T : move(_,_,T) }.

goal(X,Y) :- cell(X,Y,goal).
finished(T) :- time(T), 
               count_goals(N), 
               N { box(X,Y,T) : goal(X,Y) } N.
count_goals(N) :- N = #count { X,Y : goal(X,Y) }.

:- not finished(max_steps). 

% Output formatting
move(DName, T) :- move(DX, DY, T), dir_name(DX, DY, DName).
#show move/2.

