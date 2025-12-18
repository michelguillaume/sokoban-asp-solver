% Sokoban Solver - SIMPLE OPT (push-based)

#const max_steps = 35.

direction(0, -1; 0, 1; -1, 0; 1, 0).

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

time(0..max_steps).
step(1..max_steps).

at(X, Y, 0) :- initial_player(X, Y), walkable(X,Y).
box(X, Y, 0) :- initial_box(X, Y), walkable(X,Y).

reach(X, Y, T) :- at(X, Y, T).
reach(NX, NY, T) :-
    reach(X, Y, T),
    direction(DX, DY),
    NX = X+DX, NY = Y+DY,
    walkable(NX, NY),
    not box(NX, NY, T).

can_push(BX, BY, DX, DY, T) :-
    step(T),
    box(BX, BY, T-1),
    direction(DX, DY),
    PX = BX-DX, PY = BY-DY,
    reach(PX, PY, T-1),
    NX = BX+DX, NY = BY+DY,
    walkable(NX, NY),
    not box(NX, NY, T-1),
    not dead(NX, NY).

{ do_push(BX, BY, DX, DY, T) : can_push(BX, BY, DX, DY, T) } 1 :- step(T).
did_push(T) :- do_push(_,_,_,_,T).

:- step(T), not did_push(T), not finished(T-1).

:- do_push(BX, BY, DX, DY, T),
   do_push(PBX, PBY, PDX, PDY, T-1),
   BX = PBX+PDX, BY = PBY+PDY,
   DX = -PDX, DY = -PDY.

box(NX, NY, T) :-
    do_push(BX, BY, DX, DY, T),
    NX = BX+DX, NY = BY+DY.

box(X, Y, T) :-
    box(X, Y, T-1),
    not moved_box(X, Y, T),
    step(T).
moved_box(BX, BY, T) :- do_push(BX, BY, _, _, T).

at(BX, BY, T) :- do_push(BX, BY, _, _, T), walkable(BX, BY).
at(X, Y, T) :- at(X, Y, T-1), not did_push(T), step(T).

box_off_goal(T) :- time(T), box(X,Y,T), not goal(X,Y).
finished(T) :- time(T), not box_off_goal(T).

1 { done(T) : time(T) } 1.
:- done(T), not finished(T).
:- done(T), T > 0, finished(T-1).
:- done(D), did_push(T), T > D.

% Minimize number of pushes (done(T) is the completion time).
#minimize { T@1 : done(T) }.

push(PX, PY, DX, DY, T) :-
    do_push(BX, BY, DX, DY, T),
    PX = BX-DX, PY = BY-DY.

#show push/5.


