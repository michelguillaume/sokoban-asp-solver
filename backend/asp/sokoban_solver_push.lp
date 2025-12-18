% Sokoban Solver - Push-based

#const max_steps = 50.

direction(0, -1; 0, 1; -1, 0; 1, 0).
dir_name(0, -1, up).
dir_name(0, 1, down).
dir_name(-1, 0, left).
dir_name(1, 0, right).

walkable(X,Y) :- cell(X,Y,floor).
walkable(X,Y) :- cell(X,Y,goal).
goal(X,Y) :- cell(X,Y,goal).

% Safe dead squares (no false positives).
safe_box(X,Y) :- goal(X,Y).
safe_box(PX,PY) :-
    safe_box(X,Y),
    direction(DX,DY),
    PX = X-DX, PY = Y-DY,
    walkable(PX,PY),
    walkable(PX-DX, PY-DY).
dead(X,Y) :- cell(X,Y,floor), not safe_box(X,Y).

% Push-distance in empty map (used for guidance).
pdist(X,Y,0) :- goal(X,Y).
pdist(PX,PY,D+1) :-
    pdist(X,Y,D),
    direction(DX,DY),
    PX = X-DX, PY = Y-DY,
    walkable(PX,PY),
    walkable(PX-DX, PY-DY),
    D < 50,
    not pdist(PX,PY,D2) : D2 = 0..D.
pdist(X,Y,51) :- walkable(X,Y), not pdist(X,Y,D) : D = 0..50.

time(0..max_steps).

at(X, Y, 0) :- initial_player(X, Y), walkable(X,Y).
box(X, Y, 0) :- initial_box(X, Y), walkable(X,Y).

free(X, Y, T) :- time(T), walkable(X, Y), not box(X, Y, T).

reach(X, Y, T) :- at(X, Y, T).
reach(NX, NY, T) :-
    reach(X, Y, T),
    direction(DX, DY),
    NX = X+DX, NY = Y+DY,
    free(NX, NY, T).

% Push candidates
can_push(BX, BY, DX, DY, T) :-
    time(T), T > 0,
    box(BX, BY, T-1),
    direction(DX, DY),
    PX = BX-DX, PY = BY-DY,
    reach(PX, PY, T-1),
    free(PX, PY, T-1),
    NX = BX+DX, NY = BY+DY,
    free(NX, NY, T-1),
    not dead(NX, NY).

{ do_push(BX, BY, DX, DY, T) : can_push(BX, BY, DX, DY, T) } 1 :- time(T), T > 0.

did_push(T) :- do_push(_,_,_,_,T).
:- time(T), T > 0, not did_push(T), not finished(T-1).

% Valid push requires:
% - target cell exists and is free
% - player can reach the cell behind the box (push position)
% - don't push into static dead square
valid_push(BX, BY, DX, DY, T) :-
    do_push(BX, BY, DX, DY, T),
    can_push(BX, BY, DX, DY, T).

:- do_push(BX, BY, DX, DY, T), not valid_push(BX, BY, DX, DY, T).

% Don't immediately push a just-moved box back to its previous cell.
% If at step T-1 we pushed a box from (PBX,PBY) to (PBX+PDX,PBY+PDY),
% then at step T we cannot push that same box back with the inverse direction.

% Guidance (optional)
#heuristic do_push(BX, BY, DX, DY, T) :
    can_push(BX, BY, DX, DY, T),
    NX = BX+DX, NY = BY+DY,
    pdist(BX, BY, DB),
    pdist(NX, NY, DA),
    DA < DB. [20@1, true]

% Discourage pushes that move a box farther from goals (still allowed if necessary).
#heuristic do_push(BX, BY, DX, DY, T) :
    can_push(BX, BY, DX, DY, T),
    NX = BX+DX, NY = BY+DY,
    pdist(BX, BY, DB),
    pdist(NX, NY, DA),
    DA > DB. [5@1, false]

#heuristic do_push(BX, BY, DX, DY, T) :
    can_push(BX, BY, DX, DY, T),
    NX = BX+DX, NY = BY+DY,
    goal(NX, NY). [50@2, true]

% Discourage immediate undo pushes (push a box and then push it right back).
undo_push(BX, BY, DX, DY, T) :-
    do_push(BX, BY, DX, DY, T),
    do_push(PBX, PBY, PDX, PDY, T-1),
    BX = PBX+PDX, BY = PBY+PDY,
    DX = -PDX, DY = -PDY.
#heuristic do_push(BX, BY, DX, DY, T) : undo_push(BX, BY, DX, DY, T). [50@3, false]

% Effects
% - pushed box moves
box(NX, NY, T) :-
    do_push(BX, BY, DX, DY, T),
    NX = BX+DX, NY = BY+DY,
    walkable(NX, NY).

% - inertia for other boxes
box(X, Y, T) :-
    box(X, Y, T-1),
    not moved_box(X, Y, T),
    time(T), T > 0.
moved_box(BX, BY, T) :- do_push(BX, BY, _, _, T).

% - player ends up on the old box position
at(BX, BY, T) :- do_push(BX, BY, _, _, T), walkable(BX, BY).

% Finished when ALL boxes are on goals (goals can be >= boxes)
box_off_goal(T) :- time(T), box(X,Y,T), not goal(X,Y).
finished(T) :- time(T), not box_off_goal(T).

% Enforce that we stop at the first time the puzzle becomes solved (reduces search space).
1 { done(T) : time(T) } 1.
:- done(T), not finished(T).
:- done(T), T > 0, finished(T-1).

% No pushes after the first solved time
:- done(D), do_push(_,_,_,_,T), T > D.

#minimize { 1@2, T : do_push(_,_,_,_,T) }.

% Secondary: guide search by reducing the (empty-map) push-distance of boxes to goals.
#minimize { D@1, X,Y,T : box(X,Y,T), pdist(X,Y,D) }.

% Output push/5 in the same format as the move-based solver:
% push(PX, PY, DX, DY, T) where (PX,PY) is the player position before pushing.
push(PX, PY, DX, DY, T) :-
    do_push(BX, BY, DX, DY, T),
    PX = BX-DX, PY = BY-DY.

#show push/5.


